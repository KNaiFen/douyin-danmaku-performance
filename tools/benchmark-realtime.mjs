import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs/promises';

const bundle = (await build({ entryPoints: ['src/engine.js'], bundle: true, format: 'iife', globalName: 'Engine', write: false })).outputFiles[0].text;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const results = [];
const original = await fs.readFile('.materials/douyin-engine.js', 'utf8').catch(() => null);
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE || 4) });
  for (const renderer of [...(original ? ['original'] : []), 'canvas', 'compositor']) {
    await page.setContent('<style>html{font-size:16px}#overlay{position:relative;width:1800px;height:900px;background:#28382f;overflow:hidden}.danmu > *{position:absolute;white-space:nowrap}</style><div id="overlay"></div>');
    await page.addScriptTag({ content: bundle });
    if (renderer === 'original') {
      await page.evaluate(() => { window.webpackChunkdouyin_web = []; });
      await page.addScriptTag({ content: original });
    }
    const result = await page.evaluate(async renderer => {
      const media = new EventTarget();
      let origin = performance.now();
      Object.assign(media, { paused: false, playbackRate: 1, seeking: false });
      Object.defineProperty(media, 'currentTime', { get: () => (performance.now() - origin) / 1000 });
      let Constructor = Engine.CanvasDanmu;
      if (renderer === 'original') { const module = { exports: {} }; webpackChunkdouyin_web.at(-1)[1][150486](module); Constructor = module.exports; }
      const engine = new Constructor({ container: document.querySelector('#overlay'), player: media, defaultOff: true, channelSize: 34, renderer, trackAllocationOptimization: true, textWidthPrediction: true, postOptimization: true, hooks: {
        bulletCreateEl(raw) { const node = document.createElement('div'); node.textContent = raw.text; node.style.cssText = 'font:24px sans-serif;color:white;'; return node; },
        bulletEstimaWidth(text) { return text.length * 14 + 34; },
      } });
      const data = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), text: 'Dense comment ' + i, txt: 'Dense comment ' + i, mode: 'scroll', elLazyInit: true, start: i * 15, duration: 14400, style: { fontSize: '24px' } }));
      engine.updateComments(data);
      origin = performance.now(); engine.start();
      const gaps = [];
      let last, cancelled = false;
      function sample(time) { if (last) gaps.push(time - last); last = time; if (!cancelled) requestAnimationFrame(sample); }
      requestAnimationFrame(sample);
      await new Promise(resolve => setTimeout(resolve, 8000));
      cancelled = true;
      gaps.sort((a, b) => a - b);
      const result = { renderer, refreshSamples: gaps.length, frameGapP95Ms: gaps[Math.floor(gaps.length * 0.95)], gapsOver25ms: gaps.filter(x => x > 25).length, active: engine.active?.length ?? engine.main.queue.length, pending: engine.pending ? engine.pending.length - engine.pendingHead : null, ...engine.metrics };
      engine.destroy();
      return result;
    }, renderer);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await fs.mkdir('output', { recursive: true });
  await fs.writeFile('output/benchmark-realtime.json', JSON.stringify(results, null, 2));
} finally { await browser.close(); }
