import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs/promises';

const bundle = (await build({ entryPoints: ['src/engine.js'], bundle: true, format: 'iife', globalName: 'Engine', write: false })).outputFiles[0].text;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE || 4) });
  await page.setContent('<div id="overlay" style="position:relative;width:1800px;height:900px"></div>');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async () => {
    const media = new EventTarget();
    Object.assign(media, { currentTime: 0, paused: true, playbackRate: 1, seeking: false });
    const engine = new Engine.CanvasDanmu({ container: document.querySelector('#overlay'), player: media, defaultOff: true, channelSize: 34 });
    engine.updateComments(Array.from({ length: 5000 }, (_, i) => ({ id: String(i), text: 'Dense seek comment ' + i, start: i * 15, duration: 14400 })));
    engine.start(); engine.pause();
    const samples = [];
    for (const target of [60, 30, 65]) {
      media.currentTime = target; media.seeking = true; media.dispatchEvent(new Event('seeking'));
      engine.main.data = []; engine.stop();
      media.seeking = false; media.dispatchEvent(new Event('seeked'));
      engine.clear(); engine.stop();
      const start = performance.now();
      const previousFrames = engine.metrics.frames;
      engine.metrics.maxFrameMs = 0;
      let firstVisibleMs;
      do {
        await new Promise(resolve => setTimeout(resolve, 4));
        if (firstVisibleMs == null && engine.active.some(c => c.x < engine.width - 100)) firstVisibleMs = performance.now() - start;
        if (performance.now() - start > 10000) throw new Error('Seek reconstruction timed out');
      } while (engine.seekTask || engine.hasRestoreWork());
      samples.push({ target, firstVisibleMs, restoredMs: performance.now() - start, maxFrameMs: engine.metrics.maxFrameMs, frames: engine.metrics.frames - previousFrames,
        active: engine.active.length, pending: engine.pending.length - engine.pendingHead,
        leftHalf: engine.active.filter(c => c.x < engine.width / 2 && c.x + c.width > 0).length,
        rightHalf: engine.active.filter(c => c.x >= engine.width / 2 && c.x < engine.width).length });
    }
    engine.destroy();
    return samples;
  });
  await fs.mkdir('output', { recursive: true });
  await fs.writeFile('output/benchmark-seek.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
