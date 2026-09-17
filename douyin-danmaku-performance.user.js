// ==UserScript==
// @name         抖音弹幕 Canvas 性能优化
// @namespace    local.douyin-danmaku-performance
// @version      0.3.4
// @description  保留弹幕内容，替换 DOM 弹幕引擎，优化播放与进度跳转。
// @match        https://www.douyin.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// ==/UserScript==

/* Bundled danmaku@2.0.9 (lane allocation and Canvas renderer)
The MIT License (MIT)

Copyright (c) 2014 Zhenye Wei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
(() => {
  // node_modules/danmaku/src/utils.js
  var raf = (function() {
    if (typeof window !== "undefined") {
      var rAF = window.requestAnimationFrame || window.mozRequestAnimationFrame || window.webkitRequestAnimationFrame;
      if (rAF) return rAF.bind(window);
    }
    return function(cb) {
      return setTimeout(cb, 50 / 3);
    };
  })();
  var caf = (function() {
    if (typeof window !== "undefined") {
      var cAF = window.cancelAnimationFrame || window.mozCancelAnimationFrame || window.webkitCancelAnimationFrame;
      if (cAF) return cAF.bind(window);
    }
    return clearTimeout;
  })();
  function collidableRange() {
    var max = 9007199254740991;
    return [
      { range: 0, time: -max, width: max, height: 0 },
      { range: max, time: max, width: 0, height: 0 }
    ];
  }
  function resetSpace(space) {
    space.ltr = collidableRange();
    space.rtl = collidableRange();
    space.top = collidableRange();
    space.bottom = collidableRange();
  }
  function now() {
    return typeof window.performance !== "undefined" && window.performance.now ? window.performance.now() : Date.now();
  }

  // node_modules/danmaku/src/internal/allocate.js
  function allocate_default(cmt) {
    var that = this;
    var ct = this.media ? this.media.currentTime : now() / 1e3;
    var pbr = this.media ? this.media.playbackRate : 1;
    function willCollide(cr2, cmt2) {
      if (cmt2.mode === "top" || cmt2.mode === "bottom") {
        return ct - cr2.time < that._.duration;
      }
      var crTotalWidth = that._.width + cr2.width;
      var crElapsed = crTotalWidth * (ct - cr2.time) * pbr / that._.duration;
      if (cr2.width > crElapsed) {
        return true;
      }
      var crLeftTime = that._.duration + cr2.time - ct;
      var cmtTotalWidth = that._.width + cmt2.width;
      var cmtTime = that.media ? cmt2.time : cmt2._utc;
      var cmtElapsed = cmtTotalWidth * (ct - cmtTime) * pbr / that._.duration;
      var cmtArrival = that._.width - cmtElapsed;
      var cmtArrivalTime = that._.duration * cmtArrival / (that._.width + cmt2.width);
      return crLeftTime > cmtArrivalTime;
    }
    var crs = this._.space[cmt.mode];
    var last = 0;
    var curr = 0;
    for (var i = 1; i < crs.length; i++) {
      var cr = crs[i];
      var requiredRange = cmt.height;
      if (cmt.mode === "top" || cmt.mode === "bottom") {
        requiredRange += cr.height;
      }
      if (cr.range - cr.height - crs[last].range >= requiredRange) {
        curr = i;
        break;
      }
      if (willCollide(cr, cmt)) {
        last = i;
      }
    }
    var channel = crs[last].range;
    var crObj = {
      range: channel + cmt.height,
      time: this.media ? cmt.time : cmt._utc,
      width: cmt.width,
      height: cmt.height
    };
    crs.splice(last + 1, curr - last - 1, crObj);
    if (cmt.mode === "bottom") {
      return this._.height - cmt.height - channel % this._.height;
    }
    return channel % (this._.height - cmt.height);
  }

  // node_modules/danmaku/src/engine/canvas.js
  var dpr = typeof window !== "undefined" && window.devicePixelRatio || 1;
  var canvasHeightCache = /* @__PURE__ */ Object.create(null);
  function canvasHeight(font, fontSize) {
    if (canvasHeightCache[font]) {
      return canvasHeightCache[font];
    }
    var height = 12;
    var regex = /(\d+(?:\.\d+)?)(px|%|em|rem)(?:\s*\/\s*(\d+(?:\.\d+)?)(px|%|em|rem)?)?/;
    var p = font.match(regex);
    if (p) {
      var fs = p[1] * 1 || 10;
      var fsu = p[2];
      var lh = p[3] * 1 || 1.2;
      var lhu = p[4];
      if (fsu === "%") fs *= fontSize.container / 100;
      if (fsu === "em") fs *= fontSize.container;
      if (fsu === "rem") fs *= fontSize.root;
      if (lhu === "px") height = lh;
      if (lhu === "%") height = fs * lh / 100;
      if (lhu === "em") height = fs * lh;
      if (lhu === "rem") height = fontSize.root * lh;
      if (lhu === void 0) height = fs * lh;
    }
    canvasHeightCache[font] = height;
    return height;
  }
  function createCommentCanvas(cmt, fontSize) {
    if (typeof cmt.render === "function") {
      var cvs = cmt.render();
      if (cvs instanceof HTMLCanvasElement) {
        cmt.width = cvs.width;
        cmt.height = cvs.height;
        return cvs;
      }
    }
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    var style = cmt.style || {};
    style.font = style.font || "10px sans-serif";
    style.textBaseline = style.textBaseline || "bottom";
    var strokeWidth = style.lineWidth * 1;
    strokeWidth = strokeWidth > 0 && strokeWidth !== Infinity ? Math.ceil(strokeWidth) : !!style.strokeStyle * 1;
    ctx.font = style.font;
    cmt.width = cmt.width || Math.max(1, Math.ceil(ctx.measureText(cmt.text).width) + strokeWidth * 2);
    cmt.height = cmt.height || Math.ceil(canvasHeight(style.font, fontSize)) + strokeWidth * 2;
    canvas.width = cmt.width * dpr;
    canvas.height = cmt.height * dpr;
    ctx.scale(dpr, dpr);
    for (var key in style) {
      ctx[key] = style[key];
    }
    var baseline = 0;
    switch (style.textBaseline) {
      case "top":
      case "hanging":
        baseline = strokeWidth;
        break;
      case "middle":
        baseline = cmt.height >> 1;
        break;
      default:
        baseline = cmt.height - strokeWidth;
    }
    if (style.strokeStyle) {
      ctx.strokeText(cmt.text, strokeWidth, baseline);
    }
    ctx.fillText(cmt.text, strokeWidth, baseline);
    return canvas;
  }
  function computeFontSize(el) {
    return window.getComputedStyle(el, null).getPropertyValue("font-size").match(/(.+)px/)[1] * 1;
  }
  function init(container) {
    var stage = document.createElement("canvas");
    stage.context = stage.getContext("2d");
    stage._fontSize = {
      root: computeFontSize(document.getElementsByTagName("html")[0]),
      container: computeFontSize(container)
    };
    return stage;
  }
  function clear(stage, comments) {
    stage.context.clearRect(0, 0, stage.width, stage.height);
    for (var i = 0; i < comments.length; i++) {
      comments[i].canvas = null;
    }
  }
  function resize(stage, width, height) {
    stage.width = width * dpr;
    stage.height = height * dpr;
    stage.style.width = width + "px";
    stage.style.height = height + "px";
  }
  function framing(stage) {
    stage.context.clearRect(0, 0, stage.width, stage.height);
  }
  function setup(stage, comments) {
    for (var i = 0; i < comments.length; i++) {
      var cmt = comments[i];
      cmt.canvas = createCommentCanvas(cmt, stage._fontSize);
    }
  }
  function render(stage, cmt) {
    stage.context.drawImage(cmt.canvas, cmt.x * dpr, cmt.y * dpr);
  }
  function remove(stage, cmt) {
    cmt.canvas = null;
  }
  var canvas_default = {
    name: "canvas",
    init,
    clear,
    resize,
    framing,
    setup,
    render,
    remove
  };

  // src/timeline.js
  function lowerBound(items, time) {
    let lo = 0;
    let hi = items.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (items[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  var Timeline = class {
    constructor() {
      this.clear();
    }
    clear() {
      this.items = [];
      this.ids = /* @__PURE__ */ new Map();
      this.serial = 0;
      this.maxDuration = 0;
    }
    update(comments, replace, now2) {
      if (replace) this.clear();
      for (const raw of comments || []) {
        if (!raw || typeof raw !== "object") continue;
        const text = raw.text ?? raw.txt ?? raw.el?.textContent;
        if (typeof text !== "string" || !text.length) continue;
        const id = String(raw.id ?? `local-${++this.serial}`);
        const start = raw.realTime || raw.start == null ? now2 : Number(raw.start) / 1e3;
        if (!Number.isFinite(start)) continue;
        const item = { id, time: Math.max(0, start), text, raw };
        this.ids.set(id, item);
        if (Number.isFinite(Number(raw.duration))) this.maxDuration = Math.max(this.maxDuration, Number(raw.duration));
      }
      this.items = [...this.ids.values()].sort((a, b) => a.time - b.time);
    }
    remove(id) {
      this.ids.delete(String(id));
      this.items = this.items.filter((item) => item.id !== String(id));
    }
    rename(oldID, newID) {
      const item = this.ids.get(String(oldID));
      if (!item) return false;
      const echoed = this.ids.get(String(newID));
      if (echoed && echoed !== item) this.items = this.items.filter((value) => value !== echoed);
      this.ids.delete(String(oldID));
      item.id = String(newID);
      item.raw.id = newID;
      this.ids.set(item.id, item);
      return true;
    }
  };

  // src/emoji.js
  function splitEmoji(text, mapping) {
    if (!mapping?.get) return [{ text }];
    const parts = [];
    let consumed = 0;
    let open = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "[") open = i;
      if (text[i] !== "]" || open < consumed) continue;
      const token = text.slice(open, i + 1);
      const url = mapping.get(token);
      if (typeof url !== "string" || !/^(https?:|data:image\/)/.test(url)) continue;
      if (open > consumed) parts.push({ text: text.slice(consumed, open) });
      parts.push({ text: token, url });
      consumed = i + 1;
      open = -1;
    }
    if (consumed < text.length) parts.push({ text: text.slice(consumed) });
    return parts.length ? parts : [{ text }];
  }
  var EmojiImages = class {
    constructor(onChange) {
      this.entries = /* @__PURE__ */ new Map();
      this.onChange = onChange;
      this.version = 0;
      this.destroyed = false;
    }
    get(url) {
      let entry = this.entries.get(url);
      if (entry) return entry;
      const image = new Image();
      entry = { image, ready: false, failed: false };
      this.entries.set(url, entry);
      image.onload = () => {
        if (this.destroyed) return;
        entry.ready = true;
        this.version++;
        this.onChange();
      };
      image.onerror = () => {
        if (this.destroyed) return;
        entry.failed = true;
        this.version++;
        this.onChange();
      };
      image.src = url;
      return entry;
    }
    destroy() {
      this.destroyed = true;
      for (const { image } of this.entries.values()) {
        image.onload = null;
        image.onerror = null;
      }
      this.entries.clear();
    }
  };
  function formatDiggCount(value) {
    const count = Math.max(0, Number(value) || 0);
    return count > 9999 ? `${(count / 1e4).toFixed(1)}\u4E07` : String(count);
  }
  var measurementContext;
  function measureRichSprite(parts, style, fontSize, images, channelSize, decorations = {}) {
    const ctx = measurementContext ||= document.createElement("canvas").getContext("2d");
    ctx.font = style.font;
    const size = fontSize;
    const measured = parts.map((part) => {
      const entry = part.url ? images.get(part.url) : null;
      return { ...part, entry, width: part.url && !entry.failed ? size + 8 : ctx.measureText(part.text).width };
    });
    const badge = decorations.showDigg || decorations.isLike;
    const count = decorations.showDigg ? formatDiggCount(decorations.diggCount) : "";
    const iconSize = Math.max(fontSize, 20);
    const badgeWidth = badge ? 12 + iconSize + (count ? 6 + ctx.measureText(count).width : 0) : 0;
    const width = Math.max(1, Math.ceil(measured.reduce((sum, part) => sum + part.width, 0) + badgeWidth) + 34);
    const height = Math.ceil(Math.max(size + 4, channelSize));
    return { measured, badge, count, iconSize, width, height };
  }
  function drawRichSprite(parts, style, fontSize, images, channelSize, decorations = {}) {
    const { measured, badge, count, iconSize, width, height } = measureRichSprite(parts, style, fontSize, images, channelSize, decorations);
    const dpr2 = window.devicePixelRatio || 1;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const size = fontSize;
    canvas.width = width * dpr2;
    canvas.height = height * dpr2;
    ctx.scale(dpr2, dpr2);
    Object.assign(ctx, style);
    if (decorations.isDanmuAuthor || decorations.isAnchor) {
      ctx.beginPath();
      ctx.roundRect(1, 1, width - 2, height - 2, Math.min(25, height / 2));
      ctx.fillStyle = decorations.isAnchor ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.2)";
      ctx.fill();
      if (decorations.isDanmuAuthor) {
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      Object.assign(ctx, style);
    }
    let x = 17;
    for (const part of measured) {
      const entry = part.entry;
      if (entry?.ready) ctx.drawImage(entry.image, x + 4, (height - size) / 2, size, size);
      else {
        ctx.strokeText(part.text, x, height / 2, part.width);
        ctx.fillText(part.text, x, height / 2, part.width);
      }
      x += part.width;
    }
    if (badge) {
      x += 12;
      ctx.fillStyle = decorations.isLike ? "#ff4370" : style.fillStyle;
      ctx.font = `${iconSize}px sans-serif`;
      ctx.strokeText("\u2665", x, height / 2, iconSize);
      ctx.fillText("\u2665", x, height / 2, iconSize);
      ctx.font = style.font;
      if (count) {
        ctx.strokeText(count, x + iconSize + 6, height / 2);
        ctx.fillText(count, x + iconSize + 6, height / 2);
      }
    }
    return { canvas, width, height, rich: parts.some((part) => part.url), imageVersion: images.version, bytes: canvas.width * canvas.height * 4 };
  }

  // src/renderer.js
  var SpriteRenderer = class {
    constructor(host, metrics) {
      this.metrics = metrics;
      this.entries = /* @__PURE__ */ new Map();
      this.layer = document.createElement("div");
      this.layer.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none;contain:layout style paint;";
      host.appendChild(this.layer);
    }
    render(comment, width, progress, playing, rate, hidden, sampledAt = performance.now()) {
      let entry = this.entries.get(comment);
      if (!entry) {
        const node2 = document.createElement("canvas");
        node2.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;will-change:transform;";
        this.layer.appendChild(node2);
        entry = { node: node2 };
        this.entries.set(comment, entry);
      }
      const { node } = entry;
      if (entry.sprite !== comment.canvas) {
        node.width = comment.canvas.width;
        node.height = comment.canvas.height;
        node.getContext("2d").drawImage(comment.canvas, 0, 0);
        node.style.width = `${comment.width}px`;
        node.style.height = `${comment.height}px`;
        entry.sprite = comment.canvas;
        this.metrics.spriteUploads++;
      }
      const opacity = String(comment.raw.style?.opacity ?? 1);
      if (entry.opacity !== opacity) {
        node.style.opacity = opacity;
        entry.opacity = opacity;
      }
      if (entry.hidden !== hidden) {
        node.style.visibility = hidden ? "hidden" : "";
        entry.hidden = hidden;
      }
      const geometry = `${width}:${comment.width}:${comment.y}:${comment.mode}:${comment.duration}`;
      const expected = Math.max(0, progress * comment.duration * 1e3);
      const shouldPlay = playing && comment.frozenProgress == null && !hidden;
      let synchronize = entry.origin !== comment.time || entry.playing !== shouldPlay;
      if (geometry !== entry.geometry) {
        entry.animation?.cancel();
        const start = comment.mode === "rtl" ? width : comment.mode === "ltr" ? -comment.width : (width - comment.width) / 2;
        const end = comment.mode === "rtl" ? -comment.width : comment.mode === "ltr" ? width : start;
        entry.animation = node.animate([
          { transform: `translate3d(${start}px,${comment.y}px,0)` },
          { transform: `translate3d(${end}px,${comment.y}px,0)` }
        ], { duration: comment.duration * 1e3, fill: "both", easing: "linear" });
        entry.animation.pause();
        entry.animation.currentTime = expected;
        entry.geometry = geometry;
        entry.playing = false;
        entry.rate = void 0;
        synchronize = true;
      }
      const animation = entry.animation;
      if (synchronize) {
        animation.playbackRate = rate;
        if (shouldPlay) {
          animation.startTime = sampledAt - expected / rate;
        } else {
          animation.pause();
          animation.currentTime = expected;
        }
        this.metrics.animationSyncs++;
      } else if (!shouldPlay && !comment.staged && entry.expected !== expected) {
        animation.currentTime = expected;
        this.metrics.animationSyncs++;
      } else if (entry.rate !== rate) {
        animation.updatePlaybackRate(rate);
      }
      entry.playing = shouldPlay;
      entry.origin = comment.time;
      entry.expected = expected;
      entry.rate = rate;
    }
    progress(comment) {
      const entry = this.entries.get(comment);
      if (!entry || entry.hidden || entry.animation.currentTime == null) return void 0;
      return entry.animation.playState === "finished" ? 1 : Number(entry.animation.currentTime) / (comment.duration * 1e3);
    }
    retain(active) {
      const current = new Set(active);
      for (const [comment, entry] of this.entries) if (!current.has(comment)) {
        entry.animation.cancel();
        entry.node.remove();
        this.entries.delete(comment);
      }
    }
    pause() {
      for (const entry of this.entries.values()) {
        entry.animation?.pause();
        entry.playing = false;
      }
    }
    clear() {
      this.retain([]);
    }
    destroy() {
      this.clear();
      this.layer.remove();
    }
  };

  // src/engine.js
  var instances = /* @__PURE__ */ new Set();
  var CanvasDanmu = class {
    constructor(config) {
      if (!config?.container || !(config.player?.video || config.player)?.addEventListener) {
        throw new Error("Unsupported danmaku container or media");
      }
      this.config = { area: { start: 0, end: 1 }, ...config };
      this.container = config.container;
      this.player = config.player;
      this.video = config.player.video || config.player;
      this.timeline = new Timeline();
      this.listeners = /* @__PURE__ */ new Map();
      this.bindings = [];
      this.hiddenModes = /* @__PURE__ */ new Set();
      this.active = [];
      this.pending = [];
      this.pendingHead = 0;
      this.restoreQueue = [];
      this.restoreHead = 0;
      this.emitted = /* @__PURE__ */ new Set();
      this.spriteCache = /* @__PURE__ */ new Map();
      this.cacheBytes = 0;
      this.emojiImages = new EmojiImages(() => {
        if (this.destroyed) return;
        this.refreshEmoji();
        if (this._status === "paused") this.draw();
        this.wake();
      });
      this.duration = 14.4;
      this.fontSize = 24;
      this.fontSizeOverride = false;
      this.durationOverrides = /* @__PURE__ */ new Map();
      this.channelSize = config.channelSize || 32;
      this.dpr = window.devicePixelRatio || 1;
      this.position = 0;
      this.raf = 0;
      this.timer = 0;
      this.destroyed = false;
      this.inView = true;
      this.lastTime = NaN;
      this._status = "closed";
      this.metrics = { frames: 0, drawn: 0, received: 0, seeks: 0, maxFrameMs: 0, frameMs: 0, layoutReads: 0, emojiSprites: 0, spriteBuilds: 0, spriteUploads: 0, animationSyncs: 0, schedulerCallbacks: 0, budgetYields: 0 };
      this.originalStyle = this.container.getAttribute("style");
      this.hadDanmuClass = this.container.classList.contains("danmu");
      this.container.classList.add("danmu");
      this.container.dataset.dyDanmakuEngine = "canvas";
      this.host = document.createElement("div");
      this.host.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none!important;overflow:visible;";
      this.container.appendChild(this.host);
      this.stage = canvas_default.init(this.host);
      if (!this.stage.context) {
        this.host.remove();
        throw new Error("Canvas 2D is unavailable");
      }
      this.stage.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;";
      this.host.appendChild(this.stage);
      if (config.renderer !== "canvas" && typeof this.stage.animate === "function") {
        this.renderer = new SpriteRenderer(this.host, this.metrics);
        this.stage.style.display = "none";
      }
      this.space = {};
      resetSpace(this.space);
      this.main = {};
      Object.defineProperties(this.main, {
        data: { get: () => this.timeline.items.map((c) => c.raw), set: (data) => this.updateComments(data, true) },
        queue: { get: () => this.active },
        _status: { get: () => this._status },
        status: { get: () => this._status },
        channel: { get: () => ({ containerWidth: this.width, containerHeight: this.height, width: this.width, height: this.height }) }
      });
      this.bind(this.video, "seeking", () => {
        this.beginSeek();
        this.resetFrame(true);
        this.metrics.seeks++;
        this.cancel();
      });
      this.bind(this.video, "seeked", () => {
        this.buffering = false;
        this.resetFrame(true);
        clearTimeout(this.seekTask);
        this.seekTask = setTimeout(() => {
          this.seekTask = 0;
          this.seekCycle = false;
          if (this.seekResume && this._status === "closed") this._status = this.video.paused ? "paused" : "playing";
          this.seekResume = null;
          if (this._status !== "closed") {
            this.frame();
            this.wake(true);
          }
        }, 0);
      });
      this.bind(this.video, "play", () => {
        if (this._status === "paused") this._status = "playing";
        this.draw();
        this.wake(true);
      });
      this.bind(this.video, "playing", () => {
        this.buffering = false;
        this.wake();
      });
      this.bind(this.video, "canplay", () => {
        this.buffering = false;
        this.wake();
      });
      this.bind(this.video, "pause", () => this.pause());
      this.bind(this.video, "waiting", () => {
        this.buffering = true;
        this.cancel();
      });
      this.bind(this.video, "ended", () => this.cancel());
      this.bind(this.video, "emptied", () => {
        clearTimeout(this.seekTask);
        this.seekTask = 0;
        this.seekCycle = false;
        this.seekResume = null;
        this.restoreTime = null;
        this.buffering = false;
        this.clear();
      });
      this.bind(this.video, "ratechange", () => {
        this.draw();
        this.wake(true);
      });
      this.bind(document, "visibilitychange", () => {
        if (document.hidden) this.cancel();
        else this.wake();
      });
      this.pointerRoot = config.player.root || this.container.parentElement || this.container;
      this.bind(this.pointerRoot, "pointermove", (event) => this.hitTest(event));
      this.bind(this.pointerRoot, "pointerleave", () => {
        if (!this.manualFreeze) this.releaseHover();
      });
      this.bind(window, "blur", () => {
        if (!this.manualFreeze) this.releaseHover();
      });
      this.bind(window, "resize", () => {
        if (this.dpr !== (window.devicePixelRatio || 1)) this.resize();
      });
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
      this.intersectionObserver = new IntersectionObserver((entries) => {
        this.inView = entries[0]?.isIntersecting !== false;
        if (this.inView) this.wake();
        else this.cancel();
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
      if (!this.listeners.has(name)) this.listeners.set(name, /* @__PURE__ */ new Set());
      this.listeners.get(name).add(callback);
      return this;
    }
    off(name, callback) {
      this.listeners.get(name)?.delete(callback);
      return this;
    }
    once(name, callback) {
      const once = (...args) => {
        this.off(name, once);
        callback.apply(this, args);
      };
      return this.on(name, once);
    }
    emit(name, ...args) {
      for (const callback of [...this.listeners.get(name) || []]) callback.apply(this, args);
    }
    get status() {
      return this._status;
    }
    get emojiListMapped() {
      return this.emojiMap;
    }
    set emojiListMapped(value) {
      this.emojiMap = value;
      this.spriteCache.clear();
      this.cacheBytes = 0;
      this.reflow();
    }
    get state() {
      return { status: this.status, comments: this.main.data, bullets: this.active, displayArea: { width: this.width, height: this.height } };
    }
    get containerPos() {
      return this.container.getBoundingClientRect();
    }
    now() {
      return Number(this.video.currentTime) || 0;
    }
    beginSeek() {
      if (this.seekResume == null) this.seekResume = this._status !== "closed";
      this.seekCycle = true;
      clearTimeout(this.seekTask);
      this.seekTask = 0;
    }
    restoreWindow() {
      return Math.max(this.duration, this.mediaDuration(this.timeline.maxDuration), ...this.durationOverrides.values());
    }
    hasRestoreWork() {
      return this.restoreBatchTime != null;
    }
    cancel() {
      cancelAnimationFrame(this.raf);
      clearTimeout(this.timer);
      this.raf = 0;
      this.timer = 0;
      this.restoreTask = null;
      this.renderer?.pause();
    }
    wake(immediate = false) {
      if (immediate) {
        clearTimeout(this.timer);
        this.timer = 0;
      }
      const restoring = this.hasRestoreWork();
      if (this.destroyed || this.raf || this.timer || this.restoreTask || this._status === "closed" || !restoring && (this._status !== "playing" || this.video.paused) || this.video.seeking || this.seekCycle || this.buffering || document.hidden || !this.inView || !this.width || !this.height) return;
      const tick = () => {
        this.raf = 0;
        this.timer = 0;
        this.metrics.schedulerCallbacks++;
        this.frame();
        this.wake();
      };
      if (restoring) {
        if (!this.restoreChannel) {
          this.restoreChannel = new MessageChannel();
          this.restoreChannel.port1.onmessage = ({ data }) => {
            if (this.restoreTask?.id !== data) return;
            const task = this.restoreTask;
            this.restoreTask = null;
            task.tick();
          };
        }
        const id = this.restoreTaskId = (this.restoreTaskId || 0) + 1;
        this.restoreTask = { id, tick };
        this.restoreChannel.port2.postMessage(id);
      } else if (this.renderer) {
        const nextTime = this.timeline.items[this.position]?.time ?? Infinity;
        const idle = !this.active.length && this.pendingHead === this.pending.length;
        const delay = idle ? Math.min(1e3, Math.max(32, (nextTime - this.now()) * 1e3 / (this.video.playbackRate || 1))) : 32;
        this.timer = setTimeout(tick, immediate ? 0 : delay);
      } else this.raf = requestAnimationFrame(tick);
    }
    start() {
      if (this.destroyed || this._status === "playing") return;
      this._status = "playing";
      this.frame();
      this.wake();
    }
    play() {
      if (this.destroyed || this._status === "closed") return;
      this._status = "playing";
      this.draw();
      this.wake(true);
    }
    pause() {
      if (this._status !== "closed") this._status = "paused";
      this.cancel();
      this.draw();
      this.wake();
    }
    stop() {
      if (this.video.seeking) this.beginSeek();
      this._status = "closed";
      this.cancel();
      this.resetFrame();
    }
    clear() {
      if (this.video.seeking) this.beginSeek();
      if (!this.seekCycle && this.restoreTime == null) this.timeline.clear();
      this.resetFrame();
    }
    resetFrame(restore = this.seekCycle || this.video.seeking || this.restoreTime != null) {
      this.releaseHover(false);
      this.active = [];
      this.pending = [];
      this.pendingHead = 0;
      this.restoreQueue = [];
      this.restoreHead = 0;
      this.candidate = null;
      this.emitted.clear();
      resetSpace(this.space);
      this.restoreTime = restore ? this.now() : null;
      this.restoreBatchTime = this.restoreTime;
      this.windowStart = restore ? Math.max(0, this.now() - this.restoreWindow()) : this.now();
      this.position = lowerBound(this.timeline.items, this.windowStart);
      this.lastTime = NaN;
      this.renderer?.clear();
      canvas_default.framing(this.stage);
    }
    updateComments(comments, replace = true) {
      if (this.destroyed) return;
      this.metrics.received += comments?.length || 0;
      if (this.video.seeking) this.beginSeek();
      if ((this.seekCycle || this.restoreTime != null) && replace && !comments?.length) return;
      const nextTime = replace ? Infinity : this.timeline.items[this.position]?.time ?? Infinity;
      if (replace) {
        for (let i = this.pendingHead; i < this.pending.length; i++) this.emitted.delete(this.pending[i].id);
        for (let i = this.restoreHead; i < this.restoreQueue.length; i++) this.emitted.delete(this.restoreQueue[i].id);
      }
      this.timeline.update(comments, replace, this.now());
      this.candidate = null;
      if (replace) {
        this.pending = [];
        this.pendingHead = 0;
        this.restoreQueue = [];
        this.restoreHead = 0;
      }
      if (this.restoreTime != null) this.windowStart = Math.max(0, this.restoreTime - this.restoreWindow());
      this.position = lowerBound(this.timeline.items, Math.max(this.windowStart, this.restoreTime != null ? this.now() - this.restoreWindow() : Math.min(nextTime, this.now() - 2)));
      if (this.restoreTime != null && this.restoreBatchTime == null && (comments || []).some((raw) => {
        const item = this.timeline.ids.get(String(raw?.id));
        return item && !this.emitted.has(item.id) && !item.raw.realTime && item.time < this.now() && item.time >= Math.max(this.windowStart, this.now() - this.restoreWindow());
      })) this.restoreBatchTime = this.now();
      for (const raw of comments || []) {
        const item = this.timeline.ids.get(String(raw?.id));
        if (!item) continue;
        if ((item.raw.prior || item.raw.realTime) && !(this.restoreTime != null && item.time < (this.restoreBatchTime ?? this.restoreTime) && !item.raw.realTime) && item.time <= this.now() && !this.emitted.has(item.id)) {
          this.emitted.add(item.id);
          this.pending.splice(this.pendingHead, 0, item);
        }
      }
      const first = comments?.[0];
      if (!this.fontSizeOverride && first?.style?.fontSize) this.fontSize = parseFloat(first.style.fontSize) || this.fontSize;
      if (!this.durationOverrides.has("scroll") && first?.duration) this.duration = this.mediaDuration(first.duration);
      this.wake(true);
    }
    mediaDuration(ms) {
      return Math.max(1, Number(ms) / 1e3 * (this.video.playbackRate || 1));
    }
    sendComment(comment) {
      this.updateComments([{ ...comment, start: comment.start ?? this.now() * 1e3 }], false);
      if (this._status !== "closed") this.frame();
    }
    removeComment(id) {
      const nextTime = this.timeline.items[this.position]?.time ?? Infinity;
      this.timeline.remove(id);
      this.candidate = null;
      this.active = this.active.filter((c) => c.id !== String(id));
      this.pending = this.pending.slice(this.pendingHead).filter((c) => c.id !== String(id));
      this.pendingHead = 0;
      this.restoreQueue = this.restoreQueue.slice(this.restoreHead).filter((c) => c.id !== String(id));
      this.restoreHead = 0;
      if (this.hovered?.id === String(id)) this.releaseHover(false);
      this.position = lowerBound(this.timeline.items, Math.max(this.windowStart, Math.min(nextTime, this.now() - 2)));
      this.rebuildSpace();
      this.draw();
    }
    setCommentID(oldID, newID) {
      const nextTime = this.timeline.items[this.position]?.time ?? Infinity;
      const local = this.active.find((c) => c.id === String(oldID));
      this.timeline.rename(oldID, newID);
      if (this.emitted.delete(String(oldID))) this.emitted.add(String(newID));
      for (const c of [...this.active, ...this.pending.slice(this.pendingHead), ...this.restoreQueue.slice(this.restoreHead)]) if (c.id === String(oldID)) {
        c.id = String(newID);
        c.raw.id = newID;
        if (c.el) {
          c.el.id = String(newID);
          c.el.querySelector("[data-danmu-id]")?.setAttribute("data-danmu-id", String(newID));
        }
      }
      if (local) {
        if (this.hovered && this.hovered !== local && this.hovered.id === String(newID)) this.releaseHover();
        this.active = this.active.filter((c) => c === local || c.id !== String(newID));
      }
      const queued = new Set(this.active.map((c) => c.id));
      this.pending = this.pending.slice(this.pendingHead).filter((c) => {
        if (queued.has(c.id)) return false;
        queued.add(c.id);
        return true;
      });
      this.pendingHead = 0;
      this.restoreQueue = this.restoreQueue.slice(this.restoreHead).filter((c) => {
        if (queued.has(c.id)) return false;
        queued.add(c.id);
        return true;
      });
      this.restoreHead = 0;
      this.candidate = null;
      this.position = lowerBound(this.timeline.items, Math.max(this.windowStart, Math.min(nextTime, this.now() - 2)));
      if (this.freezeId === String(oldID)) this.freezeId = String(newID);
      this.rebuildSpace();
      this.draw();
    }
    setCommentLike(id, like) {
      this.candidate = null;
      const item = this.timeline.ids.get(String(id));
      if (item) {
        item.raw.like = like;
        item.raw._ = { ...item.raw._, isLike: typeof like === "boolean" ? like : !!like, ...typeof like === "object" ? like : {} };
        for (const c of this.active) if (c.id === String(id)) Object.assign(c, this.sprite(c));
        const node = this.hovered?.id === String(id) ? this.hovered.el?.querySelector("[data-danmu-id]") : null;
        node?.setAttribute("data-is-like", String(item.raw._.isLike));
        if (item.raw._.diggCount != null) node?.setAttribute("data-digg-count", String(item.raw._.diggCount));
        this.rebuildSpace();
        this.draw();
      }
    }
    setCommentDuration(id, duration) {
      const item = this.timeline.ids.get(String(id));
      if (!item || !(Number(duration) > 0)) return;
      item.raw.duration = duration;
      this.timeline.maxDuration = Math.max(this.timeline.maxDuration, Number(duration));
      for (const c of this.active) if (c.id === String(id)) this.retime(c, this.mediaDuration(duration));
      this.rebuildSpace();
      this.draw();
    }
    setAllDuration(mode = "scroll", duration, force = true) {
      if (!(duration > 0)) return;
      const seconds = this.mediaDuration(duration);
      if (force) this.durationOverrides.set(mode, seconds);
      if (mode === "scroll") this.duration = seconds;
      for (const item of this.timeline.items) if ((item.raw.mode || "scroll") === mode) item.raw.duration = duration;
      for (const c of this.active) if ((c.raw.mode || "scroll") === mode) this.retime(c, seconds);
      this.rebuildSpace();
      this.draw();
      this.wake();
    }
    setPlayRate(mode, rate) {
      if (rate > 0) this.setAllDuration(mode, 14400 / rate);
    }
    setOpacity(value) {
      if (Number.isFinite(Number(value))) this.container.style.opacity = String(Math.max(0, Math.min(1, Number(value))));
    }
    setFontSize(size, channelSize) {
      if (!(parseFloat(size) > 0)) return;
      this.fontSizeOverride = true;
      this.fontSize = parseFloat(size);
      this.channelSize = Number(channelSize) || this.channelSize;
      this.spriteCache.clear();
      this.cacheBytes = 0;
      this.resize();
    }
    setArea(area) {
      this.config.area = { start: 0, end: 1, ...area };
      this.resize();
    }
    hide(mode = "scroll") {
      this.hiddenModes.add(mode);
      if (this.hovered && this.isHidden(this.hovered)) this.releaseHover(false);
      this.active = this.active.filter((c) => !this.isHidden(c));
      this.rebuildSpace();
      this.draw();
    }
    show(mode = "scroll") {
      this.hiddenModes.delete(mode);
      this.wake();
    }
    isHidden(item) {
      return this.hiddenModes.has(item.raw.mode || "scroll") || item.raw.color && this.hiddenModes.has("color");
    }
    setDirection(direction = "r2l") {
      this.config.direction = direction;
      for (const c of this.active) if ((c.raw.mode || "scroll") === "scroll") c.mode = direction === "l2r" ? "ltr" : "rtl";
      this.rebuildSpace();
      this.draw();
    }
    resize() {
      if (this.destroyed) return;
      this.metrics.layoutReads++;
      if (this.dpr !== (window.devicePixelRatio || 1)) {
        this.dpr = window.devicePixelRatio || 1;
        this.spriteCache.clear();
        this.cacheBytes = 0;
      }
      const previousHeight = this.renderHeight;
      this.width = this.container.clientWidth;
      this.height = this.container.clientHeight;
      const area = this.config.area;
      this.top = Math.max(0, Math.min(1, area.start || 0)) * this.height;
      this.renderHeight = area.lines > 0 ? Math.min(this.height - this.top, area.lines * this.channelSize) : Math.max(0, this.height * Math.min(1, area.end ?? 1) - this.top);
      this.host.style.top = `${this.top}px`;
      this.host.style.height = `${this.renderHeight}px`;
      if (this.renderer) {
        this.stage.width = 1;
        this.stage.height = 1;
      } else {
        this.stage.width = Math.ceil(this.width * this.dpr);
        this.stage.height = Math.ceil(this.renderHeight * this.dpr);
        this.stage.style.width = `${this.width}px`;
        this.stage.style.height = `${this.renderHeight}px`;
      }
      if (this.windowStart == null) this.resetFrame();
      else this.reflow(previousHeight);
      this.emit("channel_resize");
      this.wake();
    }
    sprite(item, measureOnly = false) {
      const style = item.raw.style || {};
      const fontSize = this.fontSize;
      const text = item.text;
      const parts = splitEmoji(text, this.emojiListMapped);
      const rich = parts.some((part) => part.url);
      const decorations = { isDanmuAuthor: !!item.raw.prior && !item.raw._?.isAnchor, ...item.raw._ };
      const key = JSON.stringify([parts, fontSize, this.channelSize, this.dpr, style.color || "#fff", decorations.isLike, decorations.showDigg, decorations.diggCount, decorations.isDanmuAuthor, decorations.isAnchor, rich ? this.emojiImages.version : 0]);
      let cached = this.spriteCache.get(key);
      if (cached) {
        this.spriteCache.delete(key);
        this.spriteCache.set(key, cached);
        return cached;
      }
      const style2d = { font: `400 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`, fillStyle: style.color || "#fff", strokeStyle: "#000", lineWidth: 2, textBaseline: "middle" };
      if (measureOnly) {
        const { width, height } = measureRichSprite(parts, style2d, fontSize, this.emojiImages, this.channelSize, decorations);
        return { width, height, fontSize };
      }
      cached = { ...drawRichSprite(parts, style2d, fontSize, this.emojiImages, this.channelSize, decorations), fontSize };
      this.metrics.spriteBuilds++;
      if (rich) this.metrics.emojiSprites++;
      while (this.cacheBytes + cached.bytes > 16 * 1024 * 1024 && this.spriteCache.size) {
        const oldest = this.spriteCache.keys().next().value;
        this.cacheBytes -= this.spriteCache.get(oldest).bytes;
        this.spriteCache.delete(oldest);
      }
      if (cached.bytes <= 16 * 1024 * 1024) {
        this.spriteCache.set(key, cached);
        this.cacheBytes += cached.bytes;
      }
      return cached;
    }
    refreshEmoji() {
      this.candidate = null;
      let resized = false;
      for (const c of this.active) {
        if (c.rich && c.imageVersion !== this.emojiImages.version) {
          const next = this.sprite(c);
          if (next.width !== c.width) resized = true;
          Object.assign(c, next);
        }
      }
      if (resized) this.reflow();
    }
    progress(c, time = this.now()) {
      return c.frozenProgress ?? (time - c.time) / c.duration;
    }
    flightProgress(c, time = this.now()) {
      return c.frozenProgress ?? (this._status === "playing" && !this.video.paused && !c.staged ? this.renderer?.progress(c) : void 0) ?? this.progress(c, time);
    }
    retime(c, duration) {
      if (Math.abs(c.duration - duration) < 1e-8) return;
      const progress = c.frozenProgress ?? (this._status === "playing" && !this.video.paused ? this.renderer?.progress(c) : void 0) ?? this.progress(c);
      c.duration = duration;
      c.time = this.now() - progress * duration;
    }
    rebuildSpace() {
      resetSpace(this.space);
      for (const c of this.active) {
        const y = c.mode === "bottom" ? this.renderHeight - c.height - c.y : c.y;
        const record = { range: y + c.height, time: c.frozenProgress == null ? c.time : this.now() + c.duration, width: c.width, height: c.height };
        this.space[c.mode].splice(-1, 0, record);
      }
      for (const lane of Object.values(this.space)) lane.sort((a, b) => a.range - b.range);
    }
    xAt(c, time = this.now()) {
      const progress = this.progress(c, time);
      return this.xForProgress(c, progress);
    }
    xForProgress(c, progress) {
      return c.mode === "rtl" ? this.width - (this.width + c.width) * progress : c.mode === "ltr" ? (this.width + c.width) * progress - c.width : (this.width - c.width) / 2;
    }
    overlapsDuringFlight(candidate, active = this.active, time = this.now()) {
      const velocity = (c) => c.frozenProgress != null || !["rtl", "ltr"].includes(c.mode) ? 0 : (c.mode === "rtl" ? -1 : 1) * (this.width + c.width) / c.duration;
      const remaining = (c, progress) => c.frozenProgress != null ? Infinity : Math.max(0, c.duration * (1 - progress));
      const candidateProgress = this.flightProgress(candidate, time);
      for (const other of active) {
        if (other.mode !== candidate.mode || other.y + other.height <= candidate.y || candidate.y + candidate.height <= other.y) continue;
        const otherProgress = this.flightProgress(other, time);
        const lifetime = Math.min(remaining(candidate, candidateProgress), remaining(other, otherProgress));
        if (lifetime <= 0) continue;
        const gap = this.xForProgress(candidate, candidateProgress) - this.xForProgress(other, otherProgress);
        const relativeSpeed = velocity(candidate) - velocity(other);
        const endGap = relativeSpeed === 0 ? gap : gap + relativeSpeed * lifetime;
        if (Math.max(gap, endGap) > -candidate.width + 0.01 && Math.min(gap, endGap) < other.width - 0.01) return true;
      }
      return false;
    }
    reflow(previousHeight = this.renderHeight) {
      if (!this.stage) return;
      this.candidate = null;
      this.releaseHover();
      const kept = [];
      const overflow = [];
      for (const c of this.active) {
        const oldHeight = c.height;
        const edge = c.mode === "bottom" ? previousHeight - c.y - oldHeight : c.y;
        Object.assign(c, this.sprite(c));
        const preferred = Math.round(edge / oldHeight);
        const rows = Math.floor(this.renderHeight / c.height);
        let placed = false;
        for (let attempt = 0; attempt <= rows; attempt++) {
          const row = attempt === 0 ? preferred : attempt - 1;
          if (row < 0 || row >= rows || attempt && row === preferred) continue;
          c.y = c.mode === "bottom" ? this.renderHeight - (row + 1) * c.height : row * c.height;
          if (!this.overlapsDuringFlight(c, kept)) {
            kept.push(c);
            placed = true;
            break;
          }
        }
        if (!placed) overflow.push(c);
      }
      this.active = kept;
      this.pending = [...overflow, ...this.pending.slice(this.pendingHead)];
      this.pendingHead = 0;
      this.rebuildSpace();
      this.draw();
    }
    frame() {
      if (this.destroyed || this.video.seeking || this.seekCycle) return;
      const begin = performance.now();
      const deadline = begin + 4;
      const time = this.now();
      if (Number.isFinite(this.lastTime) && time < this.lastTime) this.resetFrame(true);
      this.lastTime = time;
      this.active = this.active.filter((c) => {
        if (c.frozenProgress != null || this.flightProgress(c, time) < 1) return true;
        if (!c.staged) this.emit("bullet_remove", { bullet: c });
        return false;
      });
      if (!this.active.length) resetSpace(this.space);
      else if (this.freezeId) this.rebuildSpace();
      const items = this.timeline.items;
      const cutoff = this.restoreBatchTime ?? time;
      while (this.position < items.length && items[this.position].time <= cutoff) {
        if (this.position % 64 === 0 && performance.now() >= deadline) {
          this.metrics.budgetYields++;
          break;
        }
        const item = items[this.position++];
        if (this.emitted.has(item.id)) continue;
        this.emitted.add(item.id);
        if (this.isHidden(item)) continue;
        if (this.restoreTime != null && item.time < (this.restoreBatchTime ?? this.restoreTime) && !item.raw.realTime) this.restoreQueue.push(item);
        else this.pending.push(item);
      }
      if (this.restoreHead < this.restoreQueue.length) this.rebuildSpace();
      while (this.restoreHead < this.restoreQueue.length) {
        if (performance.now() >= deadline) {
          this.metrics.budgetYields++;
          break;
        }
        const item = this.restoreQueue[this.restoreHead++];
        const mode = item.raw.mode || "scroll";
        const duration = this.durationOverrides.get(mode) || (item.raw.duration ? this.mediaDuration(item.raw.duration) : this.duration);
        if (this.isHidden(item) || item.time + duration <= time) continue;
        const c = { ...item, ...this.sprite(item, true), duration, mode: mode === "scroll" ? this.config.direction === "l2r" ? "ltr" : "rtl" : mode };
        if (!["rtl", "ltr", "top", "bottom"].includes(c.mode)) c.mode = "rtl";
        const oldSpace = this.space[c.mode].slice();
        c.y = allocate_default.call({ media: { currentTime: c.time, playbackRate: 1 }, _: { width: this.width, height: 1e9, duration: c.duration, space: this.space } }, c);
        if (c.mode === "bottom") c.y = 1e9 - c.height - c.y;
        const fits = this.renderHeight && c.y + c.height <= this.renderHeight;
        if (c.mode === "bottom") c.y = this.renderHeight - c.height - c.y;
        if (fits && !this.overlapsDuringFlight(c, this.active, time)) {
          Object.assign(c, this.sprite(item));
          c.staged = true;
          this.active.push(c);
          this.renderer?.render(c, this.width, this.progress(c, time), false, this.video.playbackRate || 1, true);
        } else {
          this.space[c.mode] = oldSpace;
          this.pending.push(item);
        }
      }
      if (this.restoreHead === this.restoreQueue.length) {
        this.restoreQueue = [];
        this.restoreHead = 0;
      }
      if (this.restoreBatchTime != null && !this.restoreQueue.length && !(items[this.position]?.time <= cutoff)) {
        const publishTime = this.now();
        if (items[this.position]?.time < publishTime) this.restoreBatchTime = publishTime;
        else {
          this.restoreBatchTime = null;
          for (const c of this.active) if (c.staged) {
            c.staged = false;
            this.emit("bullet_start", c);
          }
        }
      }
      while (this.restoreBatchTime == null && this.pendingHead < this.pending.length) {
        if (performance.now() >= deadline) {
          this.metrics.budgetYields++;
          break;
        }
        const item = this.pending[this.pendingHead];
        if (this.isHidden(item)) {
          this.pendingHead++;
          continue;
        }
        const mode = item.raw.mode || "scroll";
        if (this.candidate?.item !== item) this.candidate = { item, comment: { ...item, ...this.sprite(item) } };
        const c = this.candidate.comment;
        c.staged = false;
        c.mode = mode === "scroll" ? this.config.direction === "l2r" ? "ltr" : "rtl" : mode;
        if (!["rtl", "ltr", "top", "bottom"].includes(c.mode)) c.mode = "rtl";
        c.time = time;
        c.duration = this.durationOverrides.get(mode) || (item.raw.duration ? this.mediaDuration(item.raw.duration) : this.duration);
        const oldSpace = this.space[c.mode].slice();
        c.y = allocate_default.call({ media: { currentTime: time, playbackRate: 1 }, _: { width: this.width, height: 1e9, duration: c.duration, space: this.space } }, c);
        if (c.mode === "bottom") c.y = 1e9 - c.height - c.y;
        const fits = this.renderHeight && c.y + c.height <= Math.max(c.height, this.renderHeight);
        if (c.mode === "bottom") c.y = this.renderHeight - c.height - c.y;
        if (!fits || this.overlapsDuringFlight(c)) {
          this.space[c.mode] = oldSpace;
          break;
        }
        this.candidate = null;
        this.pendingHead++;
        this.active.push(c);
        this.emit("bullet_start", c);
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
      const sampledAt = performance.now();
      const time = this.now();
      if (this.renderer) this.renderer.retain(this.active);
      else canvas_default.framing(this.stage);
      const playing = this._status === "playing" && !this.video.paused && !this.video.seeking && !this.buffering && this.inView && !document.hidden;
      for (const c of this.active) {
        const progress = this.progress(c, time);
        c.x = this.xAt(c, time);
        if (this.renderer) {
          if (c.staged && this.renderer.entries.get(c)?.sprite === c.canvas) continue;
          this.renderer.render(c, this.width, progress, playing, this.video.playbackRate || 1, c === this.hovered || !!c.staged, sampledAt);
          continue;
        }
        if (c === this.hovered || c.staged) continue;
        this.stage.context.globalAlpha = c.raw.style?.opacity == null ? 1 : Math.max(0, Math.min(1, Number(c.raw.style.opacity) || 0));
        this.stage.context.drawImage(c.canvas, c.x * this.dpr, c.y * this.dpr, c.width * this.dpr, c.height * this.dpr);
        this.metrics.drawn++;
      }
      this.stage.context.globalAlpha = 1;
    }
    hitTest(event) {
      if (this.destroyed || !this.config.mouseControl || !this.config.hooks?.bulletCreateEl || this._status === "closed") return;
      this.pointer = { x: event.clientX, y: event.clientY };
      if (this.hovered) {
        this.checkHoverBounds();
        return;
      }
      if (event.buttons) return;
      const rect = this.container.getBoundingClientRect();
      const scaleX = rect.width / this.width || 1;
      const scaleY = rect.height / this.height || 1;
      const x = (event.clientX - rect.left) / scaleX;
      const y = (event.clientY - rect.top) / scaleY - this.top;
      for (const c2 of this.active) {
        c2.x = this.xForProgress(c2, this.renderer?.progress(c2) ?? this.progress(c2));
      }
      const c = this.active.findLast((c2) => !c2.staged && x >= c2.x && x <= c2.x + c2.width && y >= c2.y && y <= c2.y + c2.height);
      if (!c) return;
      try {
        const el = this.config.hooks.bulletCreateEl(c.raw);
        if (!el) return;
        this.hovered = c;
        c.frozenProgress = this.renderer?.progress(c) ?? this.progress(c);
        c.el = el;
        Object.assign(el.style, c.raw.style || {});
        el.style.cssText += `;position:absolute;left:${Math.max(0, Math.min(this.width - c.width, c.x))}px;top:${c.y}px;pointer-events:auto;z-index:11;white-space:nowrap;font-size:${c.fontSize}px;width:max-content;min-width:${c.width}px;min-height:${c.height}px;height:auto;line-height:normal;`;
        el.style.setProperty("--primary-font-size", `${c.fontSize}px`);
        el.style.setProperty("--danmaku-img-height", `${c.fontSize}px`);
        const content = el.querySelector("[data-danmu-id]") || el.firstElementChild;
        if (content) {
          content.style.setProperty("font-size", `${c.fontSize}px`, "important");
          content.style.setProperty("margin-top", "0", "important");
          content.style.setProperty("min-height", `${c.height}px`);
          content.style.setProperty("height", `${c.height}px`);
          content.style.setProperty("box-sizing", "border-box");
          content.style.setProperty("min-width", `${c.width}px`);
          const text = content.querySelector(".danMuText");
          text?.style.setProperty("font-size", `${c.fontSize}px`, "important");
        }
        this.host.appendChild(el);
        c.leave = () => {
          if (!this.manualFreeze && !this.releasingHover) this.releaseHover();
        };
        el.addEventListener("mouseleave", c.leave);
        this.dispatchingHover = true;
        try {
          this.emit("bullet_hover", { bullet: c, event });
        } finally {
          this.dispatchingHover = false;
        }
        const menuWidth = el.getBoundingClientRect().width / scaleX;
        this.metrics.layoutReads++;
        el.style.left = `${Math.max(0, Math.min(this.width - menuWidth, c.x))}px`;
        this.hoverCheck = requestAnimationFrame(() => {
          this.hoverCheck = 0;
          this.checkHoverBounds();
        });
        this.draw();
      } catch (error) {
        this.releaseHover();
        console.warn("[DY Danmaku] Hover unavailable", error);
      }
    }
    checkHoverBounds() {
      const c = this.hovered;
      if (!c?.el || !this.pointer || this.manualFreeze) return;
      const rect = c.el.getBoundingClientRect();
      this.metrics.layoutReads++;
      const { x, y } = this.pointer;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) this.releaseHover();
    }
    freezeComment(id) {
      const c = this.active.find((c2) => c2.id === String(id));
      if (!c) return;
      c.frozenProgress = c.frozenProgress ?? this.renderer?.progress(c) ?? this.progress(c);
      this.freezeId = String(id);
      this.manualFreeze = !this.dispatchingHover;
      this.rebuildSpace();
      this.draw();
    }
    restartComment(id) {
      if (this.releasingHover) return;
      if (this.hovered?.id === String(id)) this.releaseHover();
      else {
        const c = this.active.find((c2) => c2.id === String(id));
        if (c?.frozenProgress != null) {
          c.time = this.now() - c.frozenProgress * c.duration;
          delete c.frozenProgress;
        }
        if (this.freezeId === String(id)) this.freezeId = null;
        this.manualFreeze = false;
        this.rebuildSpace();
        this.draw();
        this.wake();
      }
    }
    releaseHover(resume = true) {
      const c = this.hovered;
      if (!c || this.releasingHover) return;
      this.releasingHover = true;
      cancelAnimationFrame(this.hoverCheck);
      this.hoverCheck = 0;
      if (c.el) {
        c.el.removeEventListener("mouseleave", c.leave);
        c.el.dispatchEvent(new MouseEvent("mouseleave"));
        const node = c.el.querySelector("[data-danmu-id]");
        if (node) {
          c.raw._ = { ...c.raw._, isLike: node.getAttribute("data-is-like") === "true", diggCount: Number(node.getAttribute("data-digg-count")) || 0 };
          Object.assign(c, this.sprite(c));
        }
        try {
          this.config.hooks?.bulletDetached?.(c.raw, c.el);
        } catch (error) {
          console.warn("[DY Danmaku] Hover cleanup failed", error);
        } finally {
          c.el.remove();
          c.el = null;
        }
      }
      this.hovered = null;
      this.freezeId = null;
      this.manualFreeze = false;
      this.releasingHover = false;
      if (resume) {
        c.time = this.now() - c.frozenProgress * c.duration;
        delete c.frozenProgress;
        this.rebuildSpace();
        this.draw();
        this.wake();
      }
    }
    destroy() {
      if (this.destroyed) return;
      clearTimeout(this.seekTask);
      this.seekTask = 0;
      this.stop();
      this.destroyed = true;
      this.restoreChannel?.port1.close();
      this.restoreChannel?.port2.close();
      this.restoreChannel = null;
      this.emit("destroy");
      this.resizeObserver.disconnect();
      this.intersectionObserver.disconnect();
      for (const unbind of this.bindings) unbind();
      this.bindings.length = 0;
      this.listeners.clear();
      this.timeline.clear();
      this.spriteCache.clear();
      this.emojiImages.destroy();
      this.renderer?.destroy();
      this.host.remove();
      delete this.container.dataset.dyDanmakuEngine;
      if (!this.hadDanmuClass) this.container.classList.remove("danmu");
      if (this.originalStyle === null) this.container.removeAttribute("style");
      else this.container.setAttribute("style", this.originalStyle);
      instances.delete(this);
    }
  };

  // src/hook.js
  function installHook(scope, Replacement, diagnostics2) {
    const wrapped = /* @__PURE__ */ new WeakSet();
    const arrays = /* @__PURE__ */ new WeakSet();
    const signature = (source) => source.includes("updateComments") && source.includes("setFontSize") && source.includes("readDataV1") && source.includes("bulletCreateEl");
    function patch(chunk) {
      const modules = chunk?.[1];
      if (!modules || typeof modules !== "object") return;
      for (const id of Object.keys(modules)) {
        const original = modules[id];
        if (typeof original !== "function" || wrapped.has(original)) continue;
        const source = Function.prototype.toString.call(original);
        if (source.length < 3e4 || !signature(source)) continue;
        const factory = function(module, exports, require2) {
          original.call(this, module, exports, require2);
          const Original = module.exports;
          if (typeof Original !== "function" || typeof Original.prototype?.updateComments !== "function") {
            diagnostics2.incompatible++;
            return;
          }
          module.exports = new Proxy(Original, {
            construct(Target, args) {
              try {
                const result = new Replacement(...args);
                diagnostics2.replaced++;
                return result;
              } catch (error) {
                diagnostics2.fallbacks++;
                console.warn("[DY Danmaku] Replacement unavailable, retaining original engine", error);
                return Reflect.construct(Target, args);
              }
            }
          });
          diagnostics2.modules.push(String(id));
        };
        wrapped.add(factory);
        modules[id] = factory;
      }
    }
    function wrapArray(array2) {
      if (!Array.isArray(array2) || arrays.has(array2)) return array2;
      arrays.add(array2);
      array2.forEach(patch);
      const wrapPush = (delegate) => function(...chunks) {
        chunks.forEach(patch);
        return Reflect.apply(delegate, this, chunks);
      };
      let wrappedPush = wrapPush(array2.push);
      Object.defineProperty(array2, "push", {
        configurable: true,
        get: () => wrappedPush,
        set: (value) => {
          if (value === wrappedPush) return;
          wrappedPush = wrapPush(value);
        }
      });
      return array2;
    }
    let array = wrapArray(scope.webpackChunkdouyin_web || []);
    const descriptor = Object.getOwnPropertyDescriptor(scope, "webpackChunkdouyin_web");
    if (descriptor && !descriptor.configurable) {
      wrapArray(scope.webpackChunkdouyin_web);
      return;
    }
    Object.defineProperty(scope, "webpackChunkdouyin_web", {
      configurable: true,
      enumerable: true,
      get: () => array,
      set: (value) => {
        array = wrapArray(value);
      }
    });
  }

  // package.json
  var version = "0.3.4";

  // src/userscript.js
  var diagnostics = { version, modules: [], replaced: 0, fallbacks: 0, incompatible: 0 };
  if (!window.__DY_DANMAKU_CANVAS__) {
    Object.defineProperty(window, "__DY_DANMAKU_CANVAS__", {
      configurable: true,
      value: { status: () => ({ ...diagnostics, instances: [...instances].map((i) => ({ status: i.status, renderer: i.renderer ? "compositor" : "canvas", comments: i.timeline.items.length, active: i.active.length, pending: i.pending.length - i.pendingHead, emojiLoaded: [...i.emojiImages.entries.values()].filter((e) => e.ready).length, opacity: Number(i.container.style.opacity || 1), cacheBytes: i.cacheBytes, ...i.metrics })) }) }
    });
    installHook(window, CanvasDanmu, diagnostics);
  }
})();
