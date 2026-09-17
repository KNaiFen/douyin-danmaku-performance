export function lowerBound(items, time) {
  let lo = 0;
  let hi = items.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (items[mid].time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export class Timeline {
  constructor() { this.clear(); }
  clear() {
    this.items = [];
    this.ids = new Map();
    this.serial = 0;
    this.maxDuration = 0;
  }
  update(comments, replace, now) {
    if (replace) this.clear();
    for (const raw of comments || []) {
      if (!raw || typeof raw !== 'object') continue;
      const text = raw.text ?? raw.txt ?? raw.el?.textContent;
      if (typeof text !== 'string' || !text.length) continue;
      const id = String(raw.id ?? `local-${++this.serial}`);
      const start = raw.realTime || raw.start == null ? now : Number(raw.start) / 1000;
      if (!Number.isFinite(start)) continue;
      const item = { id, time: Math.max(0, start), text, raw };
      this.ids.set(id, item);
      if (Number.isFinite(Number(raw.duration))) this.maxDuration = Math.max(this.maxDuration, Number(raw.duration));
    }
    this.items = [...this.ids.values()].sort((a, b) => a.time - b.time);
  }
  remove(id) {
    this.ids.delete(String(id));
    this.items = this.items.filter(item => item.id !== String(id));
  }
  rename(oldID, newID) {
    const item = this.ids.get(String(oldID));
    if (!item) return false;
    const echoed = this.ids.get(String(newID));
    if (echoed && echoed !== item) this.items = this.items.filter(value => value !== echoed);
    this.ids.delete(String(oldID));
    item.id = String(newID);
    item.raw.id = newID;
    this.ids.set(item.id, item);
    return true;
  }
}
