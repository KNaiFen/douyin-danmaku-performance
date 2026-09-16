import { build } from 'esbuild';
import fs from 'node:fs/promises';

const license = await fs.readFile('node_modules/danmaku/LICENSE', 'utf8');
const { version } = JSON.parse(await fs.readFile('package.json', 'utf8'));
const banner = `// ==UserScript==
// @name         抖音弹幕 Canvas 性能优化
// @namespace    local.douyin-danmaku-performance
// @version      ${version}
// @description  保留弹幕内容，替换 DOM 弹幕引擎，优化播放与进度跳转。
// @match        https://www.douyin.com/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// ==/UserScript==
\n/* Bundled danmaku@2.0.9 (lane allocation and Canvas renderer)\n${license}*/`;
await build({ entryPoints: ['src/userscript.js'], bundle: true, format: 'iife', target: 'chrome110', outfile: 'douyin-danmaku-performance.user.js', banner: { js: banner }, legalComments: 'inline' });
await build({ entryPoints: ['src/engine.js'], bundle: true, format: 'esm', target: 'chrome110', outfile: 'output/engine.js' });
console.log('Built douyin-danmaku-performance.user.js');
