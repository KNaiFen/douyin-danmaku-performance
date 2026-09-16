import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const bundle = (await build({ entryPoints: ['src/engine.js'], bundle: true, format: 'iife', globalName: 'Engine', write: false })).outputFiles[0].text;
const baselineRef = process.env.BASELINE_REF;
const baseline = baselineRef ? (await build({
  entryPoints: ['src/engine.js'], bundle: true, format: 'iife', globalName: 'Engine', write: false,
  plugins: [{ name: 'git-baseline', setup(builder) {
    builder.onLoad({ filter: /[\\/]src[\\/][^\\/]+\.js$/ }, args => {
      const relative = path.relative(process.cwd(), args.path).split(path.sep).join('/');
      if (!relative.startsWith('src/')) return;
      return { contents: execFileSync('git', ['show', `${baselineRef}:${relative}`], { encoding: 'utf8' }), loader: 'js' };
    });
  } }],
})).outputFiles[0].text : null;
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const results = [];
const original = await fs.readFile('.materials/douyin-engine.js', 'utf8').catch(() => null);
try {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.CPU_THROTTLE || 4) });
  for (const renderer of [...(original ? ['original'] : []), 'canvas', ...(baseline ? ['baseline'] : []), 'compositor']) {
    await page.setContent('<style>html{font-size:16px}#overlay{position:relative;width:1800px;height:900px;background:#28382f;overflow:hidden}.danmu > *{position:absolute;white-space:nowrap}</style><div id="overlay"></div>');
    await page.addScriptTag({ content: renderer === 'baseline' ? baseline : bundle });
    if (renderer === 'original') {
      await page.evaluate(() => { window.webpackChunkdouyin_web = []; });
      await page.addScriptTag({ content: original });
    }
    const result = await page.evaluate(async renderer => {
      const media = new EventTarget();
      const nativeRaf = window.requestAnimationFrame.bind(window);
      let engineRafCallbacks = 0;
      window.requestAnimationFrame = callback => nativeRaf(time => { engineRafCallbacks++; callback(time); });
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
      const frameTimes = [];
      if (engine.frame) {
        const frame = engine.frame.bind(engine);
        engine.frame = () => { const begin = performance.now(); frame(); frameTimes.push(performance.now() - begin); };
      }
      engine.updateComments(data);
      origin = performance.now(); engine.start();
      const gaps = [];
      let last, cancelled = false;
      function sample(time) { if (last) gaps.push(time - last); last = time; if (!cancelled) nativeRaf(sample); }
      nativeRaf(sample);
      await new Promise(resolve => setTimeout(resolve, 8000));
      cancelled = true;
      gaps.sort((a, b) => a - b);
      frameTimes.sort((a, b) => a - b);
      const result = { renderer, engineRafCallbacks, totalFrameMs: frameTimes.reduce((sum, ms) => sum + ms, 0), frameP95Ms: frameTimes[Math.floor(frameTimes.length * 0.95)], refreshSamples: gaps.length, frameGapP95Ms: gaps[Math.floor(gaps.length * 0.95)], gapsOver25ms: gaps.filter(x => x > 25).length, active: engine.active?.length ?? engine.main.queue.length, pending: engine.pending ? engine.pending.length - engine.pendingHead : null, ...engine.metrics };
      engine.destroy();
      window.requestAnimationFrame = nativeRaf;
      return result;
    }, renderer);
    results.push(result);
    console.log(JSON.stringify(result));
  }
  await fs.mkdir('output', { recursive: true });
  await fs.writeFile('output/benchmark-realtime.json', JSON.stringify(results, null, 2));
} finally { await browser.close(); }
