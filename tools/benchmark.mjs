import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs/promises';

const bundle = (await build({ entryPoints: ['src/engine.js'], bundle: true, format: 'iife', globalName: 'Engine', write: false })).outputFiles[0].text;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  await page.setContent('<style>html{font-size:16px}#overlay{position:relative;width:1800px;height:900px}</style><div id="overlay"></div>');
  await page.addScriptTag({ content: bundle });
  const result = await page.evaluate(async renderer => {
    const media = new EventTarget();
    Object.assign(media, { currentTime: 0, paused: true, playbackRate: 1, seeking: false });
    const engine = new Engine.CanvasDanmu({ container: document.querySelector('#overlay'), player: media, defaultOff: true, channelSize: 34, renderer });
    const data = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), text: 'Dense comment ' + i, start: i * 15, duration: 14400, style: { fontSize: '24px' } }));
    engine.updateComments(data); engine.start(); engine.pause();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const samples = [];
    for (let i = 0; i < 1800; i++) {
      media.currentTime = i / 60;
      const start = performance.now(); engine.frame(); samples.push(performance.now() - start);
      if (i % 60 === 0) await new Promise(resolve => requestAnimationFrame(resolve));
    }
    const sorted = samples.slice().sort((a, b) => a - b);
    const result = { renderer: engine.renderer ? 'compositor' : 'canvas', frames: samples.length, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95Ms: sorted[Math.floor(sorted.length * 0.95)], maxMs: sorted.at(-1), active: engine.active.length, pending: engine.pending.length - engine.pendingHead, metrics: engine.metrics };
    engine.destroy(); return result;
  }, process.argv[3] || 'compositor');
  await fs.mkdir('output', { recursive: true });
  await fs.writeFile(`output/benchmark-${process.argv[2] || 'latest'}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
