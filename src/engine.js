import allocate from 'danmaku/src/internal/allocate.js';
import canvasEngine from 'danmaku/src/engine/canvas.js';
import { resetSpace } from 'danmaku/src/utils.js';
import { Timeline, lowerBound } from './timeline.js';
import { splitEmoji, EmojiImages, drawRichSprite } from './emoji.js';

export const instances = new Set();

export class CanvasDanmu {
  constructor(config) {
    if (!config?.container || !(config.player?.video || config.player)?.addEventListener) {
      throw new Error('Unsupported danmaku container or media');
    }
    this.config = { area: { start: 0, end: 1 }, ...config };
    this.container = config.container;
    this.player = config.player;
    this.video = config.player.video || config.player;
    this.timeline = new Timeline();
    this.listeners = new Map();
    this.bindings = [];
    this.hiddenModes = new Set();
    this.active = [];
    this.pending = [];
    this.pendingHead = 0;
    this.emitted = new Set();
    this.spriteCache = new Map();
    this.cacheBytes = 0;
    this.emojiImages = new EmojiImages(() => {
      if (this.destroyed) return;
      this.refreshEmoji();
      if (this._status === 'paused') this.draw();
      this.wake();
    });
    this.duration = 14.4;
    this.fontSize = 24;
    this.fontSizeOverride = false;
    this.durationOverrides = new Map();
    this.channelSize = config.channelSize || 32;
    this.position = 0;
    this.raf = 0;
    this.destroyed = false;
    this.inView = true;
    this.lastTime = NaN;
    this._status = 'closed';
    this.metrics = { frames: 0, drawn: 0, received: 0, seeks: 0, maxFrameMs: 0, frameMs: 0, layoutReads: 0, emojiSprites: 0 };
    this.originalStyle = this.container.getAttribute('style');
    this.hadDanmuClass = this.container.classList.contains('danmu');
    this.container.classList.add('danmu');
    this.container.dataset.dyDanmakuEngine = 'canvas';
    this.host = document.createElement('div');
    this.host.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none!important;overflow:visible;';
    this.container.appendChild(this.host);
    this.stage = canvasEngine.init(this.host);
    if (!this.stage.context) { this.host.remove(); throw new Error('Canvas 2D is unavailable'); }
    this.stage.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
    this.host.appendChild(this.stage);
    this.space = {};
    resetSpace(this.space);
    // The site's business module reads these fields and assigns main.data on seek.
    this.main = {};
    Object.defineProperties(this.main, {
      data: { get: () => this.timeline.items.map(c => c.raw), set: data => this.updateComments(data, true) },
      queue: { get: () => this.active },
      _status: { get: () => this._status },
      status: { get: () => this._status },
      channel: { get: () => ({ containerWidth: this.width, containerHeight: this.height, width: this.width, height: this.height }) },
    });
    this.bind(this.video, 'seeking', () => { this.resetFrame(); this.metrics.seeks++; this.cancel(); });
    this.bind(this.video, 'seeked', () => { this.buffering = false; this.resetFrame(); this.wake(); });
    this.bind(this.video, 'play', () => { if (this._status === 'paused') this._status = 'playing'; this.wake(); });
    this.bind(this.video, 'playing', () => { this.buffering = false; this.wake(); });
    this.bind(this.video, 'canplay', () => { this.buffering = false; this.wake(); });
    this.bind(this.video, 'pause', () => this.pause());
    this.bind(this.video, 'waiting', () => { this.buffering = true; this.cancel(); });
    this.bind(this.video, 'ended', () => this.cancel());
    this.bind(this.video, 'emptied', () => { this.buffering = false; this.clear(); });
    this.bind(this.video, 'ratechange', () => this.wake());
    this.bind(document, 'visibilitychange', () => {
      if (document.hidden) this.cancel();
      else this.wake();
    });
    this.pointerRoot = config.player.root || this.container.parentElement || this.container;
    this.bind(this.pointerRoot, 'pointermove', event => this.hitTest(event));
    this.bind(this.pointerRoot, 'pointerleave', () => { if (!this.manualFreeze) this.releaseHover(); });
    this.bind(window, 'blur', () => { if (!this.manualFreeze) this.releaseHover(); });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.intersectionObserver = new IntersectionObserver(entries => {
      this.inView = entries[0]?.isIntersecting !== false;
      if (this.inView) this.wake(); else this.cancel();
    });
    this.intersectionObserver.observe(this.container);
    this.resize();
    this.updateComments(config.comments || [], true);
    instances.add(this);
    if (!config.defaultOff) this.start();
  }

  bind(target, name, callback) {
    target.addEventListener(name, callback);
    this.bindings.push(() => target.removeEventListener(name, callback));
  }
  on(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
    return this;
  }
  off(name, callback) { this.listeners.get(name)?.delete(callback); return this; }
  once(name, callback) {
    const once = (...args) => { this.off(name, once); callback.apply(this, args); };
    return this.on(name, once);
  }
  emit(name, ...args) { for (const callback of [...(this.listeners.get(name) || [])]) callback.apply(this, args); }
  get status() { return this._status; }
  get emojiListMapped() { return this.emojiMap; }
  set emojiListMapped(value) {
    this.emojiMap = value;
    this.spriteCache.clear(); this.cacheBytes = 0;
    this.reflow();
  }
  get state() { return { status: this.status, comments: this.main.data, bullets: this.active, displayArea: { width: this.width, height: this.height } }; }
  get containerPos() { return this.container.getBoundingClientRect(); }
  now() { return Number(this.video.currentTime) || 0; }
  cancel() { cancelAnimationFrame(this.raf); this.raf = 0; }
  wake() {
    if (this.destroyed || this.raf || this._status !== 'playing' || this.video.paused || this.video.seeking || this.buffering || document.hidden || !this.inView || !this.width || !this.height) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.frame();
      this.wake();
    });
  }
  start() { if (this.destroyed || this._status === 'playing') return; this._status = 'playing'; this.frame(); this.wake(); }
  play() { if (this.destroyed || this._status === 'closed') return; this._status = 'playing'; this.wake(); }
  pause() { if (this._status !== 'closed') this._status = 'paused'; this.cancel(); }
  stop() { this._status = 'closed'; this.cancel(); this.resetFrame(); }
  clear() { this.timeline.clear(); this.resetFrame(); }
  resetFrame() {
    this.releaseHover(false);
    this.active = [];
    this.pending = [];
    this.pendingHead = 0;
    this.emitted.clear();
    resetSpace(this.space);
    this.windowStart = this.now();
    this.position = lowerBound(this.timeline.items, this.windowStart);
    this.lastTime = NaN;
    canvasEngine.framing(this.stage);
  }
  updateComments(comments, replace = true) {
    if (this.destroyed) return;
    this.metrics.received += comments?.length || 0;
    this.timeline.update(comments, replace, this.now());
    if (replace) { this.pending = []; this.pendingHead = 0; }
    this.position = lowerBound(this.timeline.items, Math.max(this.windowStart, this.now() - 2));
    // Priority and realtime comments must still appear when their server offset
    // predates the current seek window (including comments sent while paused).
    for (const raw of comments || []) {
      const item = this.timeline.ids.get(String(raw?.id));
      if (!item) continue;
      if ((item.raw.prior || item.raw.realTime) && item.time <= this.now() && !this.emitted.has(item.id)) {
        this.emitted.add(item.id);
        this.pending.splice(this.pendingHead, 0, item);
      }
    }
    const first = comments?.[0];
    if (!this.fontSizeOverride && first?.style?.fontSize) this.fontSize = parseFloat(first.style.fontSize) || this.fontSize;
    if (!this.durationOverrides.has('scroll') && first?.duration) this.duration = this.mediaDuration(first.duration);
    this.wake();
  }
  mediaDuration(ms) { return Math.max(1, Number(ms) / 1000 * (this.video.playbackRate || 1)); }
  sendComment(comment) {
    this.updateComments([{ ...comment, start: comment.start ?? this.now() * 1000 }], false);
    if (this._status !== 'closed') this.frame();
  }
  removeComment(id) {
    this.timeline.remove(id);
    this.active = this.active.filter(c => c.id !== String(id));
    this.pending = this.pending.slice(this.pendingHead).filter(c => c.id !== String(id));
    this.pendingHead = 0;
    if (this.hovered?.id === String(id)) this.releaseHover(false);
    this.position = lowerBound(this.timeline.items, Math.max(this.windowStart, this.now() - 2));
    this.rebuildSpace();
    this.draw();
  }
  setCommentID(oldID, newID) {
    if (!this.timeline.rename(oldID, newID)) return;
    if (this.emitted.delete(String(oldID))) this.emitted.add(String(newID));
    for (const c of this.active) if (c.id === String(oldID)) {
      c.id = String(newID);
      if (c.el) {
        c.el.id = String(newID);
        c.el.querySelector('[data-danmu-id]')?.setAttribute('data-danmu-id', String(newID));
      }
    }
    if (this.freezeId === String(oldID)) this.freezeId = String(newID);
  }
  setCommentLike(id, like) {
    const item = this.timeline.ids.get(String(id));
    if (item) {
      item.raw.like = like;
      item.raw._ = { ...item.raw._, isLike: typeof like === 'boolean' ? like : !!like, ...(typeof like === 'object' ? like : {}) };
      for (const c of this.active) if (c.id === String(id)) Object.assign(c, this.sprite(c));
      const node = this.hovered?.id === String(id) ? this.hovered.el?.querySelector('[data-danmu-id]') : null;
      node?.setAttribute('data-is-like', String(item.raw._.isLike));
      if (item.raw._.diggCount != null) node?.setAttribute('data-digg-count', String(item.raw._.diggCount));
      this.rebuildSpace(); this.draw();
    }
  }
  setCommentDuration(id, duration) {
    const item = this.timeline.ids.get(String(id));
    if (!item || !(Number(duration) > 0)) return;
    item.raw.duration = duration;
    for (const c of this.active) if (c.id === String(id)) this.retime(c, this.mediaDuration(duration));
    this.rebuildSpace();
    this.draw();
  }
  setAllDuration(mode = 'scroll', duration, force = true) {
    if (!(duration > 0)) return;
    const seconds = this.mediaDuration(duration);
    if (force) this.durationOverrides.set(mode, seconds);
    if (mode === 'scroll') this.duration = seconds;
    for (const item of this.timeline.items) if ((item.raw.mode || 'scroll') === mode) item.raw.duration = duration;
    for (const c of this.active) if ((c.raw.mode || 'scroll') === mode) this.retime(c, seconds);
    this.rebuildSpace();
    this.draw();
    this.wake();
  }
  setPlayRate(mode, rate) { if (rate > 0) this.setAllDuration(mode, 14400 / rate); }
  setOpacity(value) { if (Number.isFinite(Number(value))) this.container.style.opacity = String(Math.max(0, Math.min(1, Number(value)))); }
  setFontSize(size, channelSize) {
    if (!(parseFloat(size) > 0)) return;
    this.fontSizeOverride = true;
    this.fontSize = parseFloat(size);
    this.channelSize = Number(channelSize) || this.channelSize;
    this.spriteCache.clear(); this.cacheBytes = 0;
    this.resize();
  }
  setArea(area) { this.config.area = { start: 0, end: 1, ...area }; this.resize(); }
  hide(mode = 'scroll') {
    this.hiddenModes.add(mode);
    if (this.hovered && this.isHidden(this.hovered)) this.releaseHover(false);
    this.active = this.active.filter(c => !this.isHidden(c));
    this.rebuildSpace(); this.draw();
  }
  show(mode = 'scroll') { this.hiddenModes.delete(mode); this.wake(); }
  isHidden(item) { return this.hiddenModes.has(item.raw.mode || 'scroll') || (item.raw.color && this.hiddenModes.has('color')); }
  setDirection(direction = 'r2l') {
    this.config.direction = direction;
    for (const c of this.active) if ((c.raw.mode || 'scroll') === 'scroll') c.mode = direction === 'l2r' ? 'ltr' : 'rtl';
    this.rebuildSpace(); this.draw();
  }
  resize() {
    if (this.destroyed) return;
    const rect = this.container.getBoundingClientRect();
    this.metrics.layoutReads++;
    this.width = rect.width;
    this.height = rect.height;
    const area = this.config.area;
    this.top = Math.max(0, Math.min(1, area.start || 0)) * this.height;
    this.renderHeight = area.lines > 0 ? Math.min(this.height - this.top, area.lines * this.channelSize) : Math.max(0, this.height * Math.min(1, area.end ?? 1) - this.top);
    this.host.style.top = `${this.top}px`;
    this.host.style.height = `${this.renderHeight}px`;
    canvasEngine.resize(this.stage, this.width, this.renderHeight);
    if (this.windowStart == null) this.resetFrame();
    else this.reflow();
    this.emit('channel_resize');
    this.wake();
  }

  sprite(item) {
    const style = item.raw.style || {};
    const fontSize = this.fontSize;
    const text = item.text;
    const parts = splitEmoji(text, this.emojiListMapped);
    const rich = parts.some(part => part.url);
    const decorations = { isDanmuAuthor: !!item.raw.prior && !item.raw._?.isAnchor, ...item.raw._ };
    const key = JSON.stringify([parts, fontSize, this.channelSize, style.color || '#fff', decorations.isLike, decorations.showDigg, decorations.diggCount, decorations.isDanmuAuthor, decorations.isAnchor, rich ? this.emojiImages.version : 0]);
    let cached = this.spriteCache.get(key);
    if (cached) { this.spriteCache.delete(key); this.spriteCache.set(key, cached); return cached; }
    const style2d = { font: `400 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`, fillStyle: style.color || '#fff', strokeStyle: '#000', lineWidth: 2, textBaseline: 'middle' };
    cached = { ...drawRichSprite(parts, style2d, fontSize, this.emojiImages, this.channelSize, decorations), fontSize };
    if (rich) this.metrics.emojiSprites++;
    while (this.cacheBytes + cached.bytes > 16 * 1024 * 1024 && this.spriteCache.size) {
      const oldest = this.spriteCache.keys().next().value;
      this.cacheBytes -= this.spriteCache.get(oldest).bytes;
      this.spriteCache.delete(oldest);
    }
    if (cached.bytes <= 16 * 1024 * 1024) { this.spriteCache.set(key, cached); this.cacheBytes += cached.bytes; }
    return cached;
  }

  refreshEmoji() {
    for (const c of this.active) {
      if (c.rich && c.imageVersion !== this.emojiImages.version) {
        const next = this.sprite(c);
        c.canvas = next.canvas;
        c.imageVersion = next.imageVersion;
      }
    }
  }

  progress(c, time = this.now()) { return c.frozenProgress ?? (time - c.time) / c.duration; }
  retime(c, duration) {
    const progress = this.progress(c);
    c.duration = duration;
    c.time = this.now() - progress * duration;
  }
  rebuildSpace() {
    resetSpace(this.space);
    for (const c of this.active) {
      const y = c.mode === 'bottom' ? this.renderHeight - c.height - c.y : c.y;
      const record = { range: y + c.height, time: c.frozenProgress == null ? c.time : this.now() + c.duration, width: c.width, height: c.height };
      this.space[c.mode].splice(-1, 0, record);
    }
    for (const lane of Object.values(this.space)) lane.sort((a, b) => a.range - b.range);
  }
  reflow() {
    if (!this.stage) return;
    this.releaseHover();
    const kept = [];
    const overflow = [];
    for (const c of this.active) {
      const oldHeight = c.height;
      Object.assign(c, this.sprite(c));
      c.y = Math.round(c.y / oldHeight) * c.height;
      if (c.y + c.height <= this.renderHeight) kept.push(c);
      else overflow.push(c);
    }
    this.active = kept;
    this.pending = [...overflow, ...this.pending.slice(this.pendingHead)];
    this.pendingHead = 0;
    this.rebuildSpace();
    this.draw();
  }

  frame() {
    if (this.destroyed) return;
    const begin = performance.now();
    const time = this.now();
    if (Number.isFinite(this.lastTime) && (time < this.lastTime || time - this.lastTime > 1)) this.resetFrame();
    this.lastTime = time;
    this.active = this.active.filter(c => {
      if (c.frozenProgress != null || this.progress(c, time) <= 1) return true;
      this.emit('bullet_remove', { bullet: c });
      return false;
    });
    if (!this.active.length) resetSpace(this.space);
    else if (this.freezeId) this.rebuildSpace();
    const items = this.timeline.items;
    while (this.position < items.length && items[this.position].time <= time) {
      const item = items[this.position++];
      if (this.emitted.has(item.id)) continue;
      this.emitted.add(item.id);
      if (this.isHidden(item)) continue;
      this.pending.push(item);
    }
    while (this.pendingHead < this.pending.length) {
      const item = this.pending[this.pendingHead];
      if (this.isHidden(item)) { this.pendingHead++; continue; }
      const mode = item.raw.mode || 'scroll';
      const c = { ...item, ...this.sprite(item), mode: mode === 'scroll' ? (this.config.direction === 'l2r' ? 'ltr' : 'rtl') : mode };
      if (!['rtl', 'ltr', 'top', 'bottom'].includes(c.mode)) c.mode = 'rtl';
      c.time = time;
      c.duration = this.durationOverrides.get(mode) || (item.raw.duration ? this.mediaDuration(item.raw.duration) : this.duration);
      const oldSpace = this.space[c.mode].slice();
      // An unbounded virtual height lets the upstream allocator report overflow
      // instead of wrapping colliding comments over existing text. Keep overflow
      // queued until a lane opens; seeking explicitly discards the old-time queue.
      c.y = allocate.call({ media: { currentTime: time, playbackRate: 1 }, _: { width: this.width, height: 1e9, duration: c.duration, space: this.space } }, c);
      if (c.mode === 'bottom') c.y = 1e9 - c.height - c.y;
      if (!this.renderHeight || c.y + c.height > Math.max(c.height, this.renderHeight)) {
        this.space[c.mode] = oldSpace;
        break;
      }
      if (c.mode === 'bottom') c.y = this.renderHeight - c.height - c.y;
      this.pendingHead++;
      this.active.push(c);
      this.emit('bullet_start', c);
    }
    if (this.pendingHead > 1024 || this.pendingHead === this.pending.length) {
      this.pending = this.pending.slice(this.pendingHead);
      this.pendingHead = 0;
    }
    this.draw();
    this.metrics.frames++;
    this.metrics.frameMs = performance.now() - begin;
    this.metrics.maxFrameMs = Math.max(this.metrics.maxFrameMs, this.metrics.frameMs);
  }

  draw() {
    const time = this.now();
    canvasEngine.framing(this.stage);
    for (const c of this.active) {
      if (c === this.hovered) continue;
      const progress = this.progress(c, time);
      c.x = c.mode === 'rtl' ? this.width - (this.width + c.width) * progress : c.mode === 'ltr' ? (this.width + c.width) * progress - c.width : (this.width - c.width) / 2;
      this.stage.context.globalAlpha = c.raw.style?.opacity == null ? 1 : Math.max(0, Math.min(1, Number(c.raw.style.opacity) || 0));
      canvasEngine.render(this.stage, c);
      this.metrics.drawn++;
    }
    this.stage.context.globalAlpha = 1;
  }

  hitTest(event) {
    if (this.destroyed || !this.config.mouseControl || !this.config.hooks?.bulletCreateEl || this._status === 'closed') return;
    this.pointer = { x: event.clientX, y: event.clientY };
    if (this.hovered) {
      this.checkHoverBounds();
      return;
    }
    if (event.buttons) return;
    const rect = this.container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top - this.top;
    const c = this.active.findLast(c => x >= c.x && x <= c.x + c.width && y >= c.y && y <= c.y + c.height);
    if (!c) return;
    try {
      const el = this.config.hooks.bulletCreateEl(c.raw);
      if (!el) return;
      this.hovered = c;
      c.frozenProgress = this.progress(c);
      c.el = el;
      Object.assign(el.style, c.raw.style || {});
      el.style.cssText += `;position:absolute;left:${Math.max(0, Math.min(this.width - c.width, c.x))}px;top:${c.y}px;pointer-events:auto;z-index:11;white-space:nowrap;font-size:${c.fontSize}px;width:max-content;min-width:${c.width}px;min-height:${c.height}px;height:auto;line-height:normal;`;
      el.style.setProperty('--primary-font-size', `${c.fontSize}px`);
      el.style.setProperty('--danmaku-img-height', `${c.fontSize}px`);
      const content = el.querySelector('[data-danmu-id]') || el.firstElementChild;
      if (content) {
        content.style.setProperty('font-size', `${c.fontSize}px`, 'important');
        content.style.setProperty('margin-top', '0', 'important');
        content.style.setProperty('min-height', `${c.height}px`);
        content.style.setProperty('height', `${c.height}px`);
        content.style.setProperty('box-sizing', 'border-box');
        content.style.setProperty('min-width', `${c.width}px`);
        const text = content.querySelector('.danMuText');
        text?.style.setProperty('font-size', `${c.fontSize}px`, 'important');
      }
      this.host.appendChild(el);
      c.leave = () => { if (!this.manualFreeze && !this.releasingHover) this.releaseHover(); };
      el.addEventListener('mouseleave', c.leave);
      this.dispatchingHover = true;
      try { this.emit('bullet_hover', { bullet: c, event }); }
      finally { this.dispatchingHover = false; }
      // React adds its action buttons on hover; one measurement keeps them
      // inside the player without introducing layout reads during animation.
      const menuWidth = el.getBoundingClientRect().width;
      this.metrics.layoutReads++;
      el.style.left = `${Math.max(0, Math.min(this.width - menuWidth, c.x))}px`;
      this.hoverCheck = requestAnimationFrame(() => { this.hoverCheck = 0; this.checkHoverBounds(); });
      this.draw();
    } catch (error) { this.releaseHover(); console.warn('[DY Danmaku] Hover unavailable', error); }
  }
  checkHoverBounds() {
    const c = this.hovered;
    if (!c?.el || !this.pointer || this.manualFreeze) return;
    const rect = c.el.getBoundingClientRect();
    this.metrics.layoutReads++;
    const { x, y } = this.pointer;
    // A newly mounted menu may never receive mouseleave if :hover changes its
    // geometry before the pointer enters it. Validate at the player boundary too.
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) this.releaseHover();
  }
  freezeComment(id) {
    const c = this.active.find(c => c.id === String(id));
    if (!c) return;
    c.frozenProgress = this.progress(c);
    this.freezeId = String(id);
    this.manualFreeze = !this.dispatchingHover;
    this.rebuildSpace();
  }
  restartComment(id) {
    if (this.releasingHover) return;
    if (this.hovered?.id === String(id)) this.releaseHover();
    else {
      const c = this.active.find(c => c.id === String(id));
      if (c?.frozenProgress != null) { c.time = this.now() - c.frozenProgress * c.duration; delete c.frozenProgress; }
      if (this.freezeId === String(id)) this.freezeId = null;
      this.manualFreeze = false;
      this.rebuildSpace(); this.draw(); this.wake();
    }
  }
  releaseHover(resume = true) {
    const c = this.hovered;
    if (!c || this.releasingHover) return;
    this.releasingHover = true;
    cancelAnimationFrame(this.hoverCheck);
    this.hoverCheck = 0;
    if (c.el) {
      c.el.removeEventListener('mouseleave', c.leave);
      // Let the site's listener release its own selected-bullet reference while
      // the original element still exists; restartComment is reentrancy guarded.
      c.el.dispatchEvent(new MouseEvent('mouseleave'));
      const node = c.el.querySelector('[data-danmu-id]');
      if (node) {
        c.raw._ = { ...c.raw._, isLike: node.getAttribute('data-is-like') === 'true', diggCount: Number(node.getAttribute('data-digg-count')) || 0 };
        Object.assign(c, this.sprite(c));
      }
      this.config.hooks?.bulletDetached?.(c.raw, c.el);
      c.el.remove();
      c.el = null;
    }
    this.hovered = null;
    this.freezeId = null;
    this.manualFreeze = false;
    this.releasingHover = false;
    if (resume) {
      c.time = this.now() - c.frozenProgress * c.duration;
      delete c.frozenProgress;
      this.rebuildSpace(); this.draw(); this.wake();
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    this.emit('destroy');
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    for (const unbind of this.bindings) unbind();
    this.bindings.length = 0;
    this.listeners.clear();
    this.timeline.clear();
    this.spriteCache.clear();
    this.emojiImages.destroy();
    this.host.remove();
    delete this.container.dataset.dyDanmakuEngine;
    if (!this.hadDanmuClass) this.container.classList.remove('danmu');
    if (this.originalStyle === null) this.container.removeAttribute('style');
    else this.container.setAttribute('style', this.originalStyle);
    instances.delete(this);
  }
}
