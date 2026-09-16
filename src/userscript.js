import { CanvasDanmu, instances } from './engine.js';
import { installHook } from './hook.js';
import { version } from '../package.json';

const diagnostics = { version, modules: [], replaced: 0, fallbacks: 0, incompatible: 0 };
if (!window.__DY_DANMAKU_CANVAS__) {
  Object.defineProperty(window, '__DY_DANMAKU_CANVAS__', {
    configurable: true,
    value: { status: () => ({ ...diagnostics, instances: [...instances].map(i => ({ status: i.status, renderer: i.renderer ? 'compositor' : 'canvas', comments: i.timeline.items.length, active: i.active.length, pending: i.pending.length - i.pendingHead, emojiLoaded: [...i.emojiImages.entries.values()].filter(e => e.ready).length, opacity: Number(i.container.style.opacity || 1), cacheBytes: i.cacheBytes, ...i.metrics })) }) },
  });
  installHook(window, CanvasDanmu, diagnostics);
}
