import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.addInitScript({ path: 'douyin-danmaku-performance.user.js' });
  await page.goto(process.env.DOUYIN_TEST_URL || 'https://www.douyin.com/?enter=guide&recommend=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('video'), { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => window.__DY_DANMAKU_CANVAS__?.status().replaced > 0, { timeout: 20000 }).catch(() => {});
  console.log(JSON.stringify(await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText.slice(0, 1800),
    diagnostics: window.__DY_DANMAKU_CANVAS__?.status(),
    videos: [...document.querySelectorAll('video')].map(v => ({ time: v.currentTime, duration: v.duration, paused: v.paused, ready: v.readyState })),
  })), null, 2));
  await fs.mkdir('output/playwright', { recursive: true });
  await page.screenshot({ path: 'output/playwright/live.png' });
  const modules = await page.evaluate(() => {
    let require;
    window.webpackChunkdouyin_web?.push([['local-compatibility-probe'], {}, r => { require = r; }]);
    if (!require?.m) return [];
    return Object.entries(require.m).filter(([, factory]) => /emojiListMapped/.test(String(factory))).map(([id, factory]) => ({ id, source: String(factory) }));
  });
  for (const module of modules) await fs.writeFile(`output/live-module-${module.id}.js`, module.source);
  console.log(JSON.stringify({ errors, savedModules: modules.map(m => m.id) }));
} finally {
  await browser.close();
}
