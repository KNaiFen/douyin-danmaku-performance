export function splitEmoji(text, mapping) {
  if (!mapping?.get) return [{ text }];
  const parts = [];
  let consumed = 0;
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '[') open = i;
    if (text[i] !== ']' || open < consumed) continue;
    const token = text.slice(open, i + 1);
    const url = mapping.get(token);
    if (typeof url !== 'string' || !/^(https?:|data:image\/)/.test(url)) continue;
    if (open > consumed) parts.push({ text: text.slice(consumed, open) });
    parts.push({ text: token, url });
    consumed = i + 1;
    open = -1;
  }
  if (consumed < text.length) parts.push({ text: text.slice(consumed) });
  return parts.length ? parts : [{ text }];
}

export class EmojiImages {
  constructor(onChange) {
    this.entries = new Map();
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
    // Original site image URLs may not allow CORS. No pixel readback is used in
    // production; a tainted canvas can still be composited into the video overlay.
    image.src = url;
    return entry;
  }
  destroy() {
    this.destroyed = true;
    for (const { image } of this.entries.values()) { image.onload = null; image.onerror = null; }
    this.entries.clear();
  }
}

export function formatDiggCount(value) {
  const count = Math.max(0, Number(value) || 0);
  return count > 9999 ? `${(count / 1e4).toFixed(1)}\u4e07` : String(count);
}

export function drawRichSprite(parts, style, fontSize, images, channelSize, decorations = {}) {
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = style.font;
  const size = fontSize;
  const measured = parts.map(part => ({ ...part, width: part.url ? size + 8 : ctx.measureText(part.text).width }));
  const badge = decorations.showDigg || decorations.isLike;
  const count = decorations.showDigg ? formatDiggCount(decorations.diggCount) : '';
  const iconSize = Math.max(fontSize, 20);
  const badgeWidth = badge ? 12 + iconSize + (count ? 6 + ctx.measureText(count).width : 0) : 0;
  const width = Math.max(1, Math.ceil(measured.reduce((sum, part) => sum + part.width, 0) + badgeWidth) + 34);
  const height = Math.ceil(Math.max(size + 4, channelSize));
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);
  Object.assign(ctx, style);
  if (decorations.isDanmuAuthor || decorations.isAnchor) {
    ctx.beginPath();
    ctx.roundRect(1, 1, width - 2, height - 2, Math.min(25, height / 2));
    ctx.fillStyle = decorations.isAnchor ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.2)';
    ctx.fill();
    if (decorations.isDanmuAuthor) { ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1; ctx.stroke(); }
    Object.assign(ctx, style);
  }
  let x = 17;
  for (const part of measured) {
    const entry = part.url ? images.get(part.url) : null;
    if (entry?.ready) ctx.drawImage(entry.image, x + 4, (height - size) / 2, size, size);
    else {
      ctx.strokeText(part.text, x, height / 2, part.width);
      ctx.fillText(part.text, x, height / 2, part.width);
    }
    x += part.width;
  }
  if (badge) {
    x += 12;
    ctx.fillStyle = decorations.isLike ? '#ff4370' : style.fillStyle;
    ctx.font = `${iconSize}px sans-serif`;
    ctx.strokeText('\u2665', x, height / 2, iconSize);
    ctx.fillText('\u2665', x, height / 2, iconSize);
    ctx.font = style.font;
    if (count) { ctx.strokeText(count, x + iconSize + 6, height / 2); ctx.fillText(count, x + iconSize + 6, height / 2); }
  }
  return { canvas, width, height, rich: parts.some(part => part.url), imageVersion: images.version, bytes: canvas.width * canvas.height * 4 };
}
