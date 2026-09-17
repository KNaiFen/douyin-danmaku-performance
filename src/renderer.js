export class SpriteRenderer {
  constructor(host, metrics) {
    this.metrics = metrics;
    this.entries = new Map();
    this.layer = document.createElement('div');
    this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;contain:layout style paint;';
    host.appendChild(this.layer);
  }
  render(comment, width, progress, playing, rate, hidden, sampledAt = performance.now()) {
    let entry = this.entries.get(comment);
    if (!entry) {
      const node = document.createElement('canvas');
      node.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;will-change:transform;';
      this.layer.appendChild(node);
      entry = { node };
      this.entries.set(comment, entry);
    }
    const { node } = entry;
    if (entry.sprite !== comment.canvas) {
      node.width = comment.canvas.width;
      node.height = comment.canvas.height;
      node.getContext('2d').drawImage(comment.canvas, 0, 0);
      node.style.width = `${comment.width}px`;
      node.style.height = `${comment.height}px`;
      entry.sprite = comment.canvas;
      this.metrics.spriteUploads++;
    }
    const opacity = String(comment.raw.style?.opacity ?? 1);
    if (entry.opacity !== opacity) { node.style.opacity = opacity; entry.opacity = opacity; }
    if (entry.hidden !== hidden) { node.style.visibility = hidden ? 'hidden' : ''; entry.hidden = hidden; }
    const geometry = `${width}:${comment.width}:${comment.y}:${comment.mode}:${comment.duration}`;
    const expected = Math.max(0, progress * comment.duration * 1000);
    const shouldPlay = playing && comment.frozenProgress == null && !hidden;
    let synchronize = entry.origin !== comment.time || entry.playing !== shouldPlay;
    if (geometry !== entry.geometry) {
      entry.animation?.cancel();
      const start = comment.mode === 'rtl' ? width : comment.mode === 'ltr' ? -comment.width : (width - comment.width) / 2;
      const end = comment.mode === 'rtl' ? -comment.width : comment.mode === 'ltr' ? width : start;
      entry.animation = node.animate([
        { transform: `translate3d(${start}px,${comment.y}px,0)` },
        { transform: `translate3d(${end}px,${comment.y}px,0)` },
      ], { duration: comment.duration * 1000, fill: 'both', easing: 'linear' });
      entry.animation.pause();
      entry.animation.currentTime = expected;
      entry.geometry = geometry;
      entry.playing = false;
      entry.rate = undefined;
      synchronize = true;
    }
    const animation = entry.animation;
    if (synchronize) {
      animation.playbackRate = rate;
      if (shouldPlay) {
        // Document timelines are sampled at rendering opportunities, whereas
        // media time advances during JS work. Anchor both to the same wall time.
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
      // Preserve the compositor's current position when only speed changes.
      animation.updatePlaybackRate(rate);
    }
    entry.playing = shouldPlay;
    entry.origin = comment.time;
    entry.expected = expected;
    entry.rate = rate;
  }
  progress(comment) {
    const entry = this.entries.get(comment);
    if (!entry || entry.hidden || entry.animation.currentTime == null) return undefined;
    return entry.animation.playState === 'finished' ? 1 : Number(entry.animation.currentTime) / (comment.duration * 1000);
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
    for (const entry of this.entries.values()) { entry.animation?.pause(); entry.playing = false; }
  }
  clear() { this.retain([]); }
  destroy() { this.clear(); this.layer.remove(); }
}
