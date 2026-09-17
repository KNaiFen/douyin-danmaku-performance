import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const baselineRef = process.env.BASELINE_REF;
const bundle = (await build({ entryPoints: ['src/engine.js'], bundle: true, format: 'iife', globalName: 'Engine', write: false,
  plugins: baselineRef ? [{ name: 'git-baseline', setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/][^\\/]+\.js$/ }, args => {
      const relative = path.relative(process.cwd(), args.path).split(path.sep).join('/');
      if (!relative.startsWith('src/')) return;
      return { contents: execFileSync('git', ['show', `${baselineRef}:${relative}`], { encoding: 'utf8' }), loader: 'js' };
    });
  } }] : [],
})).outputFiles[0].text;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE || 4) });
  await page.setContent('<div id="overlay" style="position:relative;width:1800px;height:900px"></div>');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async ({ rate, playing }) => {
    const media = new EventTarget();
    Object.assign(media, { currentTime: 0, paused: true, playbackRate: 1, seeking: false });
    const engine = new Engine.CanvasDanmu({ container: document.querySelector('#overlay'), player: media, defaultOff: true, channelSize: 34 });
    engine.updateComments(Array.from({ length: 5000 }, (_, i) => ({ id: String(i), text: 'Dense seek comment ' + i, start: i * 15, duration: 14400 })));
    engine.start(); engine.pause();
    const samples = [];
    const costs = {};
    for (const name of ['sprite', 'draw', 'rebuildSpace', 'overlapsDuringFlight']) {
      const method = engine[name].bind(engine);
      engine[name] = (...args) => {
        const begin = performance.now();
        const value = method(...args);
        costs[name] = (costs[name] || 0) + performance.now() - begin;
        return value;
      };
    }
    for (const target of [60, 30, 65]) {
      for (const name of Object.keys(costs)) costs[name] = 0;
      Object.defineProperty(media, 'currentTime', { configurable: true, writable: true, value: target });
      media.playbackRate = rate;
      engine.setAllDuration('scroll', 14400 / rate);
      media.currentTime = target; media.seeking = true; media.dispatchEvent(new Event('seeking'));
      engine.main.data = []; engine.stop();
      media.seeking = false; media.dispatchEvent(new Event('seeked'));
      engine.clear(); engine.stop();
      const start = performance.now();
      if (playing) {
        media.paused = false;
        Object.defineProperty(media, 'currentTime', { configurable: true, get: () => target + (performance.now() - start) / 1000 * rate });
      }
      const previousFrames = engine.metrics.frames;
      engine.metrics.maxFrameMs = 0;
      let firstVisibleMs;
      let partialSnapshots = 0;
      do {
        await new Promise(resolve => setTimeout(resolve, 4));
        const visible = engine.active.filter(c => !c.staged && c.x < engine.width - 100);
        if (firstVisibleMs == null && visible.length) firstVisibleMs = performance.now() - start;
        if (engine.hasRestoreWork() && visible.length) partialSnapshots++;
        if (performance.now() - start > 10000) throw new Error('Seek reconstruction timed out');
      } while (engine.seekTask || engine.hasRestoreWork());
      samples.push({ target, rate, playing, firstVisibleMs, partialSnapshots, restoredMs: performance.now() - start, maxFrameMs: engine.metrics.maxFrameMs, frames: engine.metrics.frames - previousFrames,
        active: engine.active.length, pending: engine.pending.length - engine.pendingHead,
        leftHalf: engine.active.filter(c => c.x < engine.width / 2 && c.x + c.width > 0).length,
        rightHalf: engine.active.filter(c => c.x >= engine.width / 2 && c.x < engine.width).length, costs: { ...costs } });
    }
    engine.destroy();
    return samples;
  }, { rate: Number(process.env.PLAYBACK_RATE || 1), playing: process.env.PLAYING === '1' });
  await fs.mkdir('output', { recursive: true });
  await fs.writeFile('output/benchmark-seek.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
