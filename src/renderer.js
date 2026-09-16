export class SpriteRenderer {
  constructor(host, metrics) {
    this.metrics = metrics;
    this.entries = new Map();
    this.layer = document.createElement('div');
    this.layer.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;contain:layout style paint;';
    host.appendChild(this.layer);
  }
  render(comment, width, progress, playing, rate, hidden) {
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
    }
    const animation = entry.animation;
    if (entry.rate !== rate) { animation.updatePlaybackRate(rate); entry.rate = rate; }
    const shouldPlay = playing && comment.frozenProgress == null && !hidden;
    // Correct media-clock drift without resampling transform from JavaScript.
    // During normal playback, the compositor owns every intermediate frame.
    const drift = Math.abs(Number(animation.currentTime) - expected);
    if (shouldPlay !== entry.playing || drift > (shouldPlay ? 100 : 0.5)) {
      animation.currentTime = expected;
      this.metrics.animationSyncs++;
    }
    if (shouldPlay !== entry.playing) {
      if (shouldPlay) animation.play(); else animation.pause();
      entry.playing = shouldPlay;
    }
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
