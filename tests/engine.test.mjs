import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import fs from 'node:fs/promises';

let browser, page, bundle;
before(async () => {
  bundle = (await build({ entryPoints: ['src/engine.js'], bundle: true, format: 'iife', globalName: 'Engine', write: false })).outputFiles[0].text;
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
});
after(async () => { await browser?.close(); });
beforeEach(async () => {
  await page.evaluate(() => window.engine?.destroy());
  await page.setContent(`<style>html {font-size:16px} #player {position:relative;width:1000px;height:500px;background:#27362e} #overlay {position:absolute;inset:0;pointer-events:none} #overlay > * {pointer-events:auto} .menu {padding:0 16px;color:white;display:flex;white-space:nowrap} .actions {display:none} .menu:hover .actions {display:inline-flex}</style><div id="player"><div id="overlay"></div></div>`);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => {
    window.media = new EventTarget();
    Object.assign(media, { currentTime: 0, playbackRate: 1, paused: true, seeking: false });
    window.detached = 0;
    window.engine = new Engine.CanvasDanmu({
      container: document.querySelector('#overlay'), player: media, defaultOff: true, mouseControl: true, channelSize: 36,
      hooks: {
        bulletCreateEl(raw) {
          const el = document.createElement('div');
          const content = document.createElement('div');
          content.className = 'menu';
          content.dataset.danmuId = raw.id;
          content.dataset.isLike = String(!!raw._?.isLike);
          content.dataset.diggCount = String(raw._?.diggCount || 0);
          const text = document.createElement('span'); text.textContent = raw.text; content.append(text);
          const button = document.createElement('button'); button.className = 'actions'; button.textContent = 'Like';
          button.onclick = () => { content.dataset.isLike = 'true'; content.dataset.diggCount = '10001'; };
          content.append(button); el.append(content); return el;
        },
        bulletDetached() { window.detached++; },
      },
    });
    window.seed = (items) => { engine.updateComments(items, true); engine.start(); engine.pause(); };
    window.advance = (time) => { media.currentTime = time; engine.lastTime = time; engine.frame(); };
    window.comment = (id, extra = {}) => ({ id, text: 'Comment ' + id, start: 0, duration: 14400, style: { color: '#fff', fontSize: '24px' }, ...extra });
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
});

test('native opacity, font size, speed and resize preserve on-screen comments', async () => {
  const result = await page.evaluate(() => {
    seed([comment('a'), comment('b')]); advance(1);
    const x = engine.active[0].x;
    engine.setAllDuration('scroll', 18000);
    const speedX = engine.active[0].x;
    engine.setOpacity(0.2);
    engine.setFontSize('32', 44);
    engine.resize();
    engine.updateComments([comment('new', { start: 5000, style: { fontSize: '16px' } })], false);
    return { x, speedX, active: engine.active.map(c => c.id), font: engine.fontSize, duration: engine.active[0].duration, opacity: getComputedStyle(engine.container).opacity, pointer: getComputedStyle(engine.host).pointerEvents, queued: engine.pending.length };
  });
  assert.equal(result.x, result.speedX);
  assert.deepEqual(result.active, ['a', 'b']);
  assert.equal(result.font, 32);
  assert.equal(result.duration, 18);
  assert.equal(result.opacity, '0.2');
  assert.equal(result.pointer, 'none');
});

test('switching one/two lines to percentage clears stale line limits', async () => {
  const result = await page.evaluate(() => {
    seed([comment('a'), comment('b')]); advance(1);
    engine.setArea({ start: 0, end: 0.1, lines: 1 });
    const one = engine.renderHeight;
    engine.setArea({ start: 0, end: 0.2, lines: 2 });
    const two = engine.renderHeight;
    engine.setArea({ start: 0, end: 0.8 });
    return { one, two, percent: engine.renderHeight, retained: engine.active.length + engine.pending.length - engine.pendingHead };
  });
  assert.equal(result.one, 36); assert.equal(result.two, 72); assert.equal(result.percent, 400);
  assert.equal(result.retained, 2);
});

test('paused realtime posts appear, rename once, and pending deletion stays deleted', async () => {
  const result = await page.evaluate(() => {
    seed([comment('a')]);
    engine.sendComment(comment('posted', { realTime: true, prior: true, start: 90000, _: { isDanmuAuthor: true } }));
    const posted = engine.active.find(c => c.id === 'posted');
    engine.setCommentID('posted', 'server-id');
    advance(0.2);
    const ids = engine.active.map(c => c.id);
    engine.setArea({ start: 0, end: 0.1, lines: 1 });
    engine.updateComments([comment('remove-me')], false); advance(0.3);
    engine.removeComment('remove-me'); advance(0.4);
    return { posted: !!posted, ids, rawID: posted.raw.id, deleted: !engine.pending.some(c => c.id === 'remove-me') && !engine.timeline.ids.has('remove-me') };
  });
  assert.ok(result.posted); assert.equal(result.rawID, 'server-id');
  assert.deepEqual(result.ids, ['a', 'server-id']); assert.ok(result.deleted);
});

test('emoji sprites load and refresh while paused; Unicode and unknown tokens survive', async () => {
  await page.evaluate(() => {
    const image = document.createElement('canvas'); image.width = 20; image.height = 20;
    const ctx = image.getContext('2d'); ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 20, 20);
    engine.emojiListMapped = new Map([['[smile]', image.toDataURL()]]);
    seed([comment('emoji', { text: 'A[smile][smile]B[unknown] \ud83d\ude00' })]); advance(2);
  });
  await page.waitForFunction(() => engine.emojiImages.version > 0);
  const result = await page.evaluate(() => {
    const c = engine.active[0];
    const pixels = c.canvas.getContext('2d').getImageData(0, 0, c.canvas.width, c.canvas.height).data;
    let green = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 0 && pixels[i + 1] === 255 && pixels[i + 2] === 0) green++;
    return { green, text: c.text, version: c.imageVersion, loaded: engine.emojiImages.entries.size };
  });
  assert.ok(result.green > 200); assert.equal(result.loaded, 1); assert.equal(result.version, 1);
  assert.ok(result.text.includes('[unknown]'));
});

test('hover freezes at current position, preserves native actions and resumes with changed likes', async () => {
  await page.evaluate(() => {
    seed([comment('a')]); advance(2);
    engine.on('bullet_hover', ({ bullet }) => {
      engine.freezeComment(bullet.id);
      bullet.el.addEventListener('mouseleave', () => engine.restartComment(bullet.id), { once: true });
    });
  });
  const point = await page.evaluate(() => { const c = engine.active[0], r = engine.container.getBoundingClientRect(); return { x: r.left + c.x + 25, y: r.top + c.y + 15 }; });
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => !!engine.hovered);
  await page.locator('.actions').click();
  const result = await page.evaluate(() => {
    const c = engine.hovered; const before = engine.progress(c);
    advance(12);
    const frozen = engine.progress(c);
    engine.restartComment(c.id);
    return { before, frozen, after: engine.progress(c), liked: c.raw._.isLike, count: c.raw._.diggCount, detached, nodes: engine.host.children.length };
  });
  assert.equal(result.before, result.frozen); assert.ok(Math.abs(result.before - result.after) < 1e-10);
  assert.ok(result.liked); assert.equal(result.count, 10001); assert.equal(result.detached, 1); assert.equal(result.nodes, 2);
});

test('hover text stays the same size and leaving text or buttons inside player always unlocks', async () => {
  await page.addStyleTag({ content: '.menu {font-size:12px;height:24px} .menu:hover {height:42px;margin-top:-9px;background:#333} .actions {height:36px}' });
  await page.evaluate(() => {
    engine.setFontSize(32, 44);
    seed([comment('a')]); advance(4);
    let selected = null;
    const leave = () => {
      if (selected?.el) {
        selected.el.removeEventListener('mouseleave', leave);
        engine.restartComment(selected.id);
      }
      selected = null;
    };
    engine.on('bullet_hover', ({ bullet }) => {
      if (bullet !== selected && bullet.el) {
        selected = bullet;
        engine.freezeComment(bullet.id);
        bullet.el.addEventListener('mouseleave', leave);
      }
    });
  });
  for (let pass = 0; pass < 3; pass++) {
    const point = await page.evaluate(() => { const c = engine.active[0], r = engine.container.getBoundingClientRect(); return { x: r.left + c.x + 25, y: r.top + c.y + 20 }; });
    await page.mouse.move(point.x, point.y);
    await page.waitForFunction(() => !!engine.hovered);
    const font = await page.locator('.menu').evaluate(el => getComputedStyle(el).fontSize);
    assert.equal(font, '32px');
    if (pass === 1) await page.locator('.actions').hover();
    else await page.mouse.move(point.x + 2, point.y + 1);
    // Stay inside the player; the old bug required leaving the whole player.
    await page.mouse.move(point.x, point.y + 90);
    await page.waitForFunction(() => !engine.hovered && !engine.freezeId);
    assert.equal(await page.locator('.menu').count(), 0);
    assert.equal(await page.evaluate(() => engine.active[0].frozenProgress), undefined);
  }
});

test('native hover text and emoji keep their painted position across font sizes and player scales', async () => {
  await page.addStyleTag({ content: `
    .menu { border:1px solid transparent; align-items:center; font-family:"PingFang SC"; font-weight:400; }
    .menu:hover { background:#333; height:42px; margin-top:-9px; }
    .danMuText { display:flex; align-items:center; }
    .danMuText img { width:var(--danmaku-img-height); height:var(--danmaku-img-height); margin:0 4px; }
    .actions { color:#ff4370; background:none; border:0; }
  ` });
  await page.evaluate(() => {
    const original = engine.config.hooks.bulletCreateEl;
    const image = document.createElement('canvas'); image.width = 20; image.height = 20;
    const ctx = image.getContext('2d'); ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 20, 20);
    window.emojiURL = image.toDataURL();
    engine.emojiListMapped = new Map([['[smile]', emojiURL]]);
    engine.config.hooks.bulletCreateEl = raw => {
      const el = original(raw);
      const text = el.querySelector('.menu > span');
      text.className = 'danMuText'; text.textContent = raw.text.replace('[smile]', '');
      if (raw.text.includes('[smile]')) { const img = new Image(); img.src = emojiURL; text.append(img); }
      return el;
    };
  });
  const bounds = async clip => {
    const png = await page.screenshot({ clip });
    return page.evaluate(async data => {
      const img = new Image(); img.src = data; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const boxes = { text: { left: Infinity, top: Infinity, right: -1, bottom: -1, sumY: 0, count: 0 }, emoji: { left: Infinity, top: Infinity, right: -1, bottom: -1, sumY: 0, count: 0 } };
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const key = pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220 ? 'text' :
          pixels[i] < 30 && pixels[i + 1] > 220 && pixels[i + 2] < 30 ? 'emoji' : null;
        if (key) { const b = boxes[key]; b.left = Math.min(b.left, x); b.top = Math.min(b.top, y); b.right = Math.max(b.right, x); b.bottom = Math.max(b.bottom, y); b.sumY += y; b.count++; }
      }
      for (const b of Object.values(boxes)) b.centerY = b.sumY / b.count;
      return boxes;
    }, 'data:image/png;base64,' + png.toString('base64'));
  };
  for (const [size, scale, rich] of [[20, 1, false], [24, 1, false], [32, 1, true], [24, 0.5, true]]) {
    await page.mouse.move(0, 700);
    const clip = await page.evaluate(({ size, scale, rich }) => {
      media.currentTime = 0;
      engine.stop(); engine.clear();
      document.querySelector('#player').style.cssText = `transform:scale(${scale});transform-origin:top left;`;
      engine.setFontSize(size, size + 12);
      seed([comment('aligned', { text: 'Hg Test \u5f39\u5e55' + (rich ? '[smile]' : '') })]); advance(5);
      const c = engine.active[0], rect = engine.container.getBoundingClientRect();
      return { x: Math.floor(rect.left + c.x * scale), y: Math.floor(rect.top + c.y * scale), width: Math.ceil(c.width * scale), height: Math.ceil(c.height * scale) };
    }, { size, scale, rich });
    await page.waitForFunction(() => !engine.active[0].rich || engine.emojiImages.version > 0);
    const before = await bounds(clip);
    if (size === 32) {
      await fs.mkdir('output/playwright', { recursive: true });
      await page.locator('#player').screenshot({ path: 'output/playwright/hover-align-before.png' });
    }
    await page.mouse.move(clip.x + 25 * scale, clip.y + (size + 12) * scale / 2);
    await page.waitForFunction(() => !!engine.hovered);
    const hovered = await bounds(clip);
    if (size === 32) await page.locator('#player').screenshot({ path: 'output/playwright/hover-align-active.png' });
    await page.mouse.move(clip.x, clip.y + 90);
    await page.waitForFunction(() => !engine.hovered);
    const after = await bounds(clip);
    for (const kind of rich ? ['text', 'emoji'] : ['text']) {
      assert.ok(before[kind].right >= 0 && hovered[kind].right >= 0, JSON.stringify({ size, scale, kind, before, hovered }));
      assert.ok(Math.abs(before[kind].centerY - hovered[kind].centerY) <= 1, JSON.stringify({ size, scale, kind, before, hovered }));
      for (const edge of ['left', 'top', 'right', 'bottom']) {
        // Downscaling a cached bitmap differs from rasterizing native DOM text.
        assert.ok(Math.abs(before[kind][edge] - hovered[kind][edge]) <= (scale < 1 ? 2 : 1), JSON.stringify({ size, scale, kind, edge, before, hovered }));
        assert.equal(before[kind][edge], after[kind][edge]);
      }
    }
  }
});

test('menu shrinking away from pointer unlocks even without a DOM mouseleave', async () => {
  const result = await page.evaluate(() => {
    seed([comment('a')]); advance(2);
    engine.on('bullet_hover', ({ bullet }) => engine.freezeComment(bullet.id));
    const c = engine.active[0], r = engine.container.getBoundingClientRect();
    engine.hitTest({ clientX: r.left + c.x + 30, clientY: r.top + c.y + 15 });
    c.el.style.left = '0px';
    engine.hitTest({ clientX: r.left + c.x + 31, clientY: r.top + c.y + 15 });
    return { hovered: !!engine.hovered, freeze: engine.freezeId, nodes: engine.host.children.length };
  });
  assert.equal(result.hovered, false); assert.equal(result.freeze, null); assert.equal(result.nodes, 2);
});

test('explicit report/login freeze remains until its native callback restarts', async () => {
  const result = await page.evaluate(() => {
    seed([comment('a')]); advance(2);
    engine.on('bullet_hover', ({ bullet }) => engine.freezeComment(bullet.id));
    const c = engine.active[0], r = engine.container.getBoundingClientRect();
    engine.hitTest({ clientX: r.left + c.x + 30, clientY: r.top + c.y + 15 });
    engine.freezeComment(c.id);
    engine.hitTest({ clientX: r.left + 10, clientY: r.top + 200 });
    const held = engine.hovered === c;
    engine.restartComment(c.id);
    return { held, released: !engine.hovered && !engine.freezeId };
  });
  assert.ok(result.held); assert.ok(result.released);
});

test('seek drops old backlog, buffering recovers on canplay and destruction cleans resources', async () => {
  const result = await page.evaluate(async () => {
    seed(Array.from({ length: 5000 }, (_, i) => comment(String(i))));
    const backlog = engine.pending.length - engine.pendingHead;
    media.dispatchEvent(new Event('waiting'));
    media.seeking = true; media.currentTime = 60; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
    engine.updateComments([comment('target', { start: 60000 })], false); engine.frame();
    await new Promise(resolve => setTimeout(resolve, 0));
    media.paused = false; engine.play(); media.dispatchEvent(new Event('canplay'));
    const recovered = !engine.buffering && !!(engine.raf || engine.timer);
    const ids = engine.active.map(c => c.id);
    engine.destroy();
    return { backlog, recovered, ids, instances: Engine.instances.size, nodes: document.querySelector('#overlay').children.length, raf: engine.raf, timer: engine.timer, bindings: engine.bindings.length };
  });
  assert.ok(result.backlog > 4000); assert.ok(result.recovered); assert.deepEqual(result.ids, ['target']);
  assert.equal(result.instances, 0); assert.equal(result.nodes, 0); assert.equal(result.raf, 0); assert.equal(result.timer, 0); assert.equal(result.bindings, 0);
});

test('full backlog drains without a fixed comment limit and modes can be toggled independently', async () => {
  const result = await page.evaluate(() => {
    seed(Array.from({ length: 250 }, (_, i) => comment(String(i))));
    const seen = new Set(engine.active.map(c => c.id));
    for (let i = 1; i < 2000 && seen.size < 250; i++) { advance(i / 2); for (const c of engine.active) seen.add(c.id); }
    engine.clear();
    engine.updateComments([comment('top', { mode: 'top', start: media.currentTime * 1000 }), comment('bottom', { mode: 'bottom', start: media.currentTime * 1000 })]);
    engine.frame(); engine.hide('top');
    return { seen: seen.size, modes: engine.active.map(c => c.mode) };
  });
  assert.equal(result.seen, 250); assert.deepEqual(result.modes, ['bottom']);
});

test('desktop and narrow layouts render nonblank with emoji, author and liked decorations', async () => {
  await fs.mkdir('output/playwright', { recursive: true });
  for (const width of [1000, 390]) {
    await page.evaluate(width => {
      media.currentTime = 0; engine.stop(); engine.clear(); document.querySelector('#player').style.width = width + 'px'; engine.resize();
      seed([comment('self', { text: '\u6211\u53d1\u9001\u7684\u5f39\u5e55', _: { isDanmuAuthor: true } }), comment('liked', { text: '\u5df2\u70b9\u8d5e\u5f39\u5e55', _: { isLike: true, showDigg: true, diggCount: 12500 } })]); advance(media.currentTime + 3);
    }, width);
    const pixels = await page.evaluate(() => {
      let count = 0;
      for (const { node } of engine.renderer.entries.values()) {
        const data = node.getContext('2d').getImageData(0, 0, node.width, node.height).data;
        for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
      }
      return count;
    });
    assert.ok(pixels > 100);
    await page.locator('#player').screenshot({ path: `output/playwright/layout-${width}.png` });
  }
});

test('native ratechange duration conversion, repeated start and data reset preserve current bullets', async () => {
  const result = await page.evaluate(() => {
    seed([comment('a')]); advance(2);
    const first = engine.active[0], x = first.x;
    media.playbackRate = 2; media.dispatchEvent(new Event('ratechange'));
    engine.setAllDuration('scroll', 14400 / media.playbackRate);
    const rateX = first.x;
    engine.main.data = [];
    engine.start(); engine.start();
    engine.setCommentDuration('a', 1000);
    return { x, rateX, duration: first.duration, same: first === engine.active[0], queue: engine.main.queue.length, data: engine.main.data.length };
  });
  assert.equal(result.x, result.rateX); assert.equal(result.duration, 14.4);
  assert.ok(result.same); assert.equal(result.queue, 1); assert.equal(result.data, 0);
});

test('saved original module is intercepted by the bundled userscript', async t => {
  let original;
  try { original = await fs.readFile('.materials/douyin-engine.js', 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') { t.skip('Local saved original is unavailable'); return; } throw error; }
  const userscript = (await build({ entryPoints: ['src/userscript.js'], bundle: true, format: 'iife', write: false })).outputFiles[0].text;
  await page.evaluate(() => engine.destroy());
  await page.addScriptTag({ content: userscript });
  await page.addScriptTag({ content: original });
  const result = await page.evaluate(() => {
    const module = { exports: {} };
    webpackChunkdouyin_web.at(-1)[1][150486](module);
    const replacement = new module.exports({ container: document.querySelector('#overlay'), player: media, defaultOff: true });
    replacement.emojiListMapped = new Map(); replacement.setOpacity(0.6);
    replacement.updateComments([comment('native')], false); replacement.start(); replacement.pause();
    const status = window.__DY_DANMAKU_CANVAS__.status();
    replacement.destroy();
    return status;
  });
  assert.equal(result.replaced, 1); assert.equal(result.fallbacks, 0);
  assert.equal(result.instances[0].active, 1); assert.equal(result.instances[0].opacity, 0.6);
});

test('queued comments never collide after individual speed changes', async () => {
  const result = await page.evaluate(() => {
    engine.setArea({ lines: 1 });
    seed([comment('slow'), comment('fast')]);
    engine.setCommentDuration('slow', 30000);
    let overlaps = 0;
    for (let i = 1; i <= 100; i++) {
      advance(i / 10);
      const row = engine.active.filter(c => c.mode === 'rtl');
      for (let a = 0; a < row.length; a++) for (let b = a + 1; b < row.length; b++) {
        if (row[a].x < row[b].x + row[b].width && row[b].x < row[a].x + row[a].width) overlaps++;
      }
    }
    return { overlaps };
  });
  assert.equal(result.overlaps, 0);
});

test('retiring frozen and resized comments never introduces overlap behind them', async () => {
  const result = await page.evaluate(() => {
    engine.setArea({ lines: 1 }); seed([comment('a'), comment('b'), comment('c')]);
    advance(4); engine.freezeComment('a');
    const before = engine.active[0].x;
    for (let i = 41; i < 150; i++) advance(i / 10);
    const frozen = engine.active[0].x;
    engine.restartComment('a');
    let overlaps = 0;
    for (let i = 150; i < 250; i++) {
      advance(i / 10);
      const row = engine.active;
      for (let a = 0; a < row.length; a++) for (let b = a + 1; b < row.length; b++) {
        if (row[a].x < row[b].x + row[b].width && row[b].x < row[a].x + row[a].width) overlaps++;
      }
    }
    return { before, frozen, overlaps };
  });
  assert.equal(result.before, result.frozen); assert.equal(result.overlaps, 0);
});

test('short display areas and missing image failures retain readable emoji fallback text', async () => {
  await page.evaluate(() => {
    engine.emojiListMapped = new Map([['[a-very-long-unknown-image]', 'data:image/png;base64,broken']]);
    seed([comment('failure', { text: '[a-very-long-unknown-image]' })]); advance(3);
  });
  await page.waitForFunction(() => engine.emojiImages.version > 0);
  const result = await page.evaluate(() => {
    const c = engine.active[0];
    const context = c.canvas.getContext('2d');
    context.font = `400 ${engine.fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    return { width: c.width, textWidth: context.measureText(c.text).width };
  });
  assert.ok(result.width >= result.textWidth);
});

test('compositor moves sprites between scheduler calls without repainting their pixels', async () => {
  const cdp = await page.context().newCDPSession(page);
  let layers = [];
  cdp.on('LayerTree.layerTreeDidChange', event => { layers = event.layers || []; });
  try {
    await cdp.send('LayerTree.enable');
    await page.evaluate(() => {
      seed([comment('moving')]); advance(2);
      const c = engine.active[0];
      engine.renderer.render(c, engine.width, engine.progress(c), true, 1, false);
      window.uploadsBefore = engine.metrics.spriteUploads;
      window.spriteNode = engine.renderer.entries.get(c).node;
    });
    const initial = await page.evaluate(() => new DOMMatrix(getComputedStyle(spriteNode).transform).m41);
    await page.waitForFunction(initial => new DOMMatrix(getComputedStyle(spriteNode).transform).m41 < initial - 20, initial);
    const result = await page.evaluate(() => ({ uploads: engine.metrics.spriteUploads, before: uploadsBefore, drawn: engine.metrics.drawn, frames: engine.metrics.frames }));
    assert.equal(result.uploads, result.before);
    assert.equal(result.drawn, 0);
    assert.equal(result.frames, 2);
    // Motion without our scheduler alone would also pass for main-thread WAAPI.
    // Check Chromium's actual layer promotion, not just the animation API used.
    const reasons = await Promise.all(layers.map(layer => cdp.send('LayerTree.compositingReasons', { layerId: layer.layerId })));
    assert.ok(reasons.some(reason => reason.compositingReasonIds.includes('ActiveTransformAnimation')), 'The sprite must have an accelerated transform animation');
  } finally { await cdp.detach(); }
});

test('compositor pauses on buffering, restarts, follows rate and releases every animation on seek', async () => {
  const result = await page.evaluate(async () => {
    seed([comment('a')]); advance(2);
    media.paused = false; engine.play(); engine.draw();
    const entry = engine.renderer.entries.get(engine.active[0]);
    const playing = entry.animation.playState;
    media.dispatchEvent(new Event('waiting'));
    const waiting = entry.animation.playState;
    media.dispatchEvent(new Event('canplay')); engine.draw();
    media.playbackRate = 2; media.dispatchEvent(new Event('ratechange'));
    await entry.animation.ready;
    const rate = entry.animation.playbackRate;
    media.paused = true; media.dispatchEvent(new Event('pause'));
    const paused = entry.animation.playState;
    media.currentTime = 60; media.dispatchEvent(new Event('seeking'));
    return { playing, waiting, paused, rate, animations: engine.host.getAnimations({ subtree: true }).length, sprites: engine.renderer.entries.size };
  });
  assert.equal(result.playing, 'running'); assert.equal(result.waiting, 'paused'); assert.equal(result.paused, 'paused');
  assert.equal(result.rate, 2); assert.equal(result.animations, 0); assert.equal(result.sprites, 0);
});

test('static sprites are not reuploaded on normal animation ticks', async () => {
  const result = await page.evaluate(() => {
    seed(Array.from({ length: 50 }, (_, i) => comment(String(i))));
    advance(1);
    const uploads = engine.metrics.spriteUploads;
    for (let i = 61; i < 120; i++) advance(i / 60);
    return { uploads, after: engine.metrics.spriteUploads, active: engine.active.length, drawn: engine.metrics.drawn };
  });
  assert.equal(result.uploads, result.after); assert.equal(result.drawn, 0); assert.ok(result.active > 0);
});

test('display density changes repaint sprites without changing their CSS size', async () => {
  const result = await page.evaluate(() => {
    seed([comment('density')]); advance(2);
    const c = engine.active[0], width = c.width, oldPixels = c.canvas.width;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    engine.resize();
    const entry = engine.renderer.entries.get(c);
    const result = { oldPixels, pixels: c.canvas.width, width: c.width, cssWidth: entry.node.style.width, uploaded: entry.node.width };
    delete window.devicePixelRatio;
    return result;
  });
  assert.equal(result.pixels, result.oldPixels * 2);
  assert.equal(result.cssWidth, `${result.width}px`);
  assert.equal(result.uploaded, result.pixels);
});

test('a main-thread stall does not discard current comments as a false seek', async () => {
  const result = await page.evaluate(() => {
    seed([comment('a')]); advance(1);
    const c = engine.active[0];
    media.currentTime = 2.5; engine.frame();
    return { same: engine.active[0] === c, time: c.time, progress: engine.progress(c) };
  });
  assert.ok(result.same); assert.equal(result.time, 0); assert.ok(result.progress > 0);
});

test('bottom comments use screen coordinates when checking occupied rows', async () => {
  const result = await page.evaluate(() => {
    engine.setArea({ lines: 2 });
    seed([comment('a', { mode: 'bottom', duration: 30000 }), comment('b', { mode: 'bottom' }), comment('c', { mode: 'bottom' })]);
    advance(15);
    const row = engine.active.filter(c => c.mode === 'bottom');
    return { ids: row.map(c => c.id), overlap: row.some((c, i) => row.slice(i + 1).some(other => c.y < other.y + other.height && other.y < c.y + c.height)) };
  });
  assert.ok(result.ids.includes('a')); assert.equal(result.overlap, false);
});

test('resizing or enlarging text relocates colliding comments without dropping them', async () => {
  const result = await page.evaluate(() => {
    engine.setArea({ lines: 1 }); seed([comment('a'), comment('b')]);
    advance(3);
    const before = engine.active.length;
    document.querySelector('#player').style.width = '240px'; engine.resize();
    engine.setFontSize(32, 44);
    const row = engine.active;
    return { before, retained: row.length + engine.pending.length - engine.pendingHead, overlap: row.some((c, i) => row.slice(i + 1).some(other => c.x < other.x + other.width && other.x < c.x + c.width)) };
  });
  assert.equal(result.before, 2); assert.equal(result.retained, 2); assert.equal(result.overlap, false);
});

test('scaled players keep local layout dimensions and hover at visible text', async () => {
  await page.evaluate(() => {
    document.querySelector('#player').style.cssText += ';transform:scale(0.5);transform-origin:top left;';
    engine.resize(); seed([comment('scaled')]); advance(5);
  });
  const point = await page.evaluate(() => {
    const c = engine.active[0], rect = engine.renderer.entries.get(c).node.getBoundingClientRect();
    return { x: rect.left + 25, y: rect.top + 8, width: engine.width };
  });
  assert.equal(point.width, 1000);
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => engine.hovered?.id === 'scaled');
  await page.mouse.move(20, 210);
  await page.waitForFunction(() => !engine.hovered);
});

test('server echo before post acknowledgement does not duplicate a queued comment', async () => {
  const result = await page.evaluate(() => {
    engine.setArea({ lines: 1 }); seed([comment('leader')]);
    engine.sendComment(comment('temporary', { realTime: true, prior: true }));
    engine.updateComments([comment('server', { prior: true })], false);
    engine.setCommentID('temporary', 'server');
    const pending = engine.pending.slice(engine.pendingHead).map(c => c.id);
    return { pending, timeline: engine.timeline.items.map(c => c.id) };
  });
  assert.deepEqual(result.pending, ['server']);
  assert.deepEqual(result.timeline, ['leader', 'server']);
});

test('active post can still be renamed after the native business clears main.data', async () => {
  const result = await page.evaluate(() => {
    seed([comment('temporary')]); advance(2);
    engine.main.data = [];
    engine.setCommentID('temporary', 'server');
    engine.updateComments([comment('server', { start: 2000 })], false); engine.frame();
    return { ids: engine.active.map(c => c.id), raw: engine.active[0].raw.id, pending: engine.pending.length - engine.pendingHead };
  });
  assert.deepEqual(result.ids, ['server']); assert.equal(result.raw, 'server'); assert.equal(result.pending, 0);
});

test('blocked comments reuse their measured sprite and burst work yields without losing data', async () => {
  const result = await page.evaluate(() => {
    engine.setArea({ lines: 1 }); seed([comment('leader'), comment('waiting')]);
    let lookups = 0;
    const sprite = engine.sprite.bind(engine);
    engine.sprite = item => { lookups++; return sprite(item); };
    for (let i = 0; i < 100; i++) engine.frame();
    const blockedLookups = lookups;
    engine.stop(); engine.clear();
    engine.updateComments(Array.from({ length: 1000 }, (_, i) => comment(String(i))));
    const clock = performance.now.bind(performance);
    let cost = 0;
    performance.now = () => { cost += 0.5; return cost; };
    engine.start();
    const firstQueued = engine.pending.length - engine.pendingHead + engine.active.length;
    for (let i = 0; i < 100 && engine.position < 1000; i++) engine.frame();
    performance.now = clock;
    return { blockedLookups, firstQueued, total: engine.pending.length - engine.pendingHead + engine.active.length, yields: engine.metrics.budgetYields };
  });
  assert.equal(result.blockedLookups, 0);
  assert.ok(result.firstQueued < 1000); assert.equal(result.total, 1000); assert.ok(result.yields > 0);
});

test('late network batches preserve older unscheduled comments after a budget yield', async () => {
  const result = await page.evaluate(() => {
    const data = Array.from({ length: 1000 }, (_, i) => comment(String(i), { start: i * 10 }));
    seed(data); engine.cancel();
    media.currentTime = 20;
    engine.updateComments([comment('late', { start: 20000 })], false);
    for (let i = 0; i < 10 && engine.position < engine.timeline.items.length; i++) engine.frame();
    return { seen: engine.emitted.size };
  });
  assert.equal(result.seen, 1001);
});

test('idle scheduling sleeps and incoming data wakes it immediately', async () => {
  const result = await page.evaluate(async () => {
    engine.start(); media.paused = false; engine.play();
    await new Promise(resolve => setTimeout(resolve, 150));
    const idleCallbacks = engine.metrics.schedulerCallbacks;
    engine.updateComments([comment('arrived')], false);
    await new Promise(resolve => setTimeout(resolve, 80));
    const active = engine.active.map(c => c.id);
    engine.destroy();
    return { idleCallbacks, active, timer: engine.timer };
  });
  assert.ok(result.idleCallbacks <= 1); assert.deepEqual(result.active, ['arrived']); assert.equal(result.timer, 0);
});

test('renaming an active post removes an already visible server echo', async () => {
  const result = await page.evaluate(() => {
    seed([comment('temporary'), comment('server')]); advance(2);
    engine.setCommentID('temporary', 'server');
    return { ids: engine.active.map(c => c.id), nodes: engine.renderer.entries.size };
  });
  assert.deepEqual(result.ids, ['server']); assert.equal(result.nodes, 1);
});

test('rebuilding animation geometry preserves effective playback rate', async () => {
  const rate = await page.evaluate(async () => {
    seed([comment('a')]); advance(2);
    media.playbackRate = 2; media.paused = false; engine.play();
    let entry = engine.renderer.entries.get(engine.active[0]);
    await entry.animation.ready;
    engine.setFontSize(32, 44);
    entry = engine.renderer.entries.get(engine.active[0]);
    await entry.animation.ready;
    const rate = entry.animation.playbackRate;
    engine.pause();
    return rate;
  });
  assert.equal(rate, 2);
});

test('seek restores in-flight comments at their target-time positions while paused', async () => {
  await page.evaluate(() => {
    seed(Array.from({ length: 12 }, (_, i) => comment(String(i), { start: (48 + i) * 1000 })));
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => engine.active.length === 12);
  const result = await page.evaluate(() => ({
    status: engine.status,
    comments: engine.active.map(c => ({ id: c.id, time: c.time, x: c.x, expected: 1000 - (1000 + c.width) * (60 - c.time) / c.duration,
      rendered: new DOMMatrix(getComputedStyle(engine.renderer.entries.get(c).node).transform).m41 })),
  }));
  assert.equal(result.status, 'paused');
  assert.ok(result.comments.some(c => c.x < 200));
  assert.ok(result.comments.some(c => c.x > 800));
  for (const c of result.comments) {
    assert.equal(c.time, 48 + Number(c.id));
    assert.ok(Math.abs(c.x - c.expected) < 0.01);
    assert.ok(Math.abs(c.rendered - c.expected) < 0.01);
  }
  await fs.mkdir('output/playwright', { recursive: true });
  await page.locator('#player').screenshot({ path: 'output/playwright/seek-restored.png' });
});

test('native seek clear/stop lifecycle retains loaded data and delayed batches fill the paused screen', async () => {
  await page.evaluate(() => {
    seed([comment('cached', { start: 55000 })]);
    media.currentTime = 60; media.seeking = true;
    // The player's listener can run before the replacement's media listener.
    engine.main.data = []; engine.stop();
    media.dispatchEvent(new Event('seeking'));
    media.seeking = false;
    engine.clear(); engine.stop();
    media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => engine.active.some(c => c.id === 'cached'));
  await page.evaluate(() => engine.updateComments([
    comment('late', { start: 52000 }), comment('expired', { start: 1000 }), comment('future', { start: 70000 }),
  ], false));
  await page.waitForFunction(() => engine.active.some(c => c.id === 'late'));
  const result = await page.evaluate(() => ({ ids: engine.active.map(c => c.id).sort(), x: engine.active.find(c => c.id === 'late').x, timer: engine.timer }));
  assert.deepEqual(result.ids, ['cached', 'late']); assert.ok(result.x < 500);
  await page.waitForFunction(() => !engine.timer);
});

test('rapid seeks discard older reconstruction tasks, old backlog and expired late responses', async () => {
  await page.evaluate(() => {
    seed(Array.from({ length: 1000 }, (_, i) => comment('old' + i)));
    engine.updateComments([comment('first', { start: 25000 }), comment('final', { start: 85000 })], false);
    for (const target of [30, 60, 90]) {
      media.currentTime = target; media.seeking = true; media.dispatchEvent(new Event('seeking'));
      media.seeking = false; media.dispatchEvent(new Event('seeked'));
    }
    engine.updateComments([comment('late-old-target', { start: 28000 })], false);
  });
  await page.waitForFunction(() => engine.active.some(c => c.id === 'final'));
  const result = await page.evaluate(() => ({ ids: engine.active.map(c => c.id), pending: engine.pending.length - engine.pendingHead, restore: engine.restoreQueue.length - engine.restoreHead }));
  assert.deepEqual(result.ids, ['final']); assert.equal(result.pending, 0); assert.equal(result.restore, 0);
});

test('seek respects actual durations, playback rate and fixed modes', async () => {
  await page.evaluate(() => {
    media.playbackRate = 2;
    seed([
      comment('slow', { start: 35000, duration: 15000 }),
      comment('expired', { start: 50000, duration: 2000 }),
      comment('top', { start: 55000, mode: 'top', duration: 7200 }),
      comment('bottom', { start: 56000, mode: 'bottom', duration: 7200 }),
    ]);
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => engine.active.length === 3);
  const result = await page.evaluate(() => ({ ids: engine.active.map(c => c.id).sort(), slow: engine.active.find(c => c.id === 'slow').duration,
    bottom: engine.active.find(c => c.id === 'bottom').y }));
  assert.deepEqual(result.ids, ['bottom', 'slow', 'top']); assert.equal(result.slow, 30); assert.ok(result.bottom > 400);
});

test('seek does not enable a closed engine and media replacement clears saved comments', async () => {
  await page.evaluate(() => {
    seed([comment('previous-video', { start: 55000 })]); engine.stop();
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => !engine.seekTask);
  assert.equal(await page.evaluate(() => engine.status), 'closed');
  const result = await page.evaluate(() => {
    media.dispatchEvent(new Event('emptied')); engine.start();
    return { data: engine.main.data.length, active: engine.active.length, restore: engine.restoreQueue.length };
  });
  assert.deepEqual(result, { data: 0, active: 0, restore: 0 });
});

test('dense paused seeks yield, retain overflow and rasterize only accepted historical comments', async () => {
  await page.evaluate(() => {
    seed(Array.from({ length: 960 }, (_, i) => comment(String(i), { start: 45610 + i * 15 })));
    window.buildsBeforeSeek = engine.metrics.spriteBuilds;
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => !engine.seekTask && !engine.hasRestoreWork());
  const result = await page.evaluate(() => {
    const row = engine.active;
    const overlap = row.some((c, i) => row.slice(i + 1).some(other =>
      c.y < other.y + other.height && other.y < c.y + c.height && c.x < other.x + other.width - 0.01 && other.x < c.x + c.width - 0.01));
    return { active: row.length, retained: row.length + engine.pending.length - engine.pendingHead, overlap,
      builds: engine.metrics.spriteBuilds - buildsBeforeSeek,
      left: row.some(c => c.x < 250 && c.x + c.width > 0), right: row.some(c => c.x > 750 && c.x < 1000) };
  });
  assert.equal(result.retained, 960); assert.equal(result.overlap, false);
  assert.ok(result.left && result.right); assert.ok(result.builds <= result.active + 1);
});

test('seek restoration retains emoji, opacity and hover release at a restored position', async () => {
  await page.evaluate(() => {
    const image = document.createElement('canvas'); image.width = 20; image.height = 20;
    const ctx = image.getContext('2d'); ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, 20, 20);
    engine.emojiListMapped = new Map([['[smile]', image.toDataURL()]]);
    engine.setOpacity(0.4);
    seed([comment('restored-emoji', { text: 'Seek [smile]', start: 55000 })]);
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => engine.active.length === 1 && engine.emojiImages.version > 0);
  const point = await page.evaluate(() => {
    const c = engine.active[0], rect = engine.container.getBoundingClientRect();
    const pixels = c.canvas.getContext('2d').getImageData(0, 0, c.canvas.width, c.canvas.height).data;
    let green = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 0 && pixels[i + 1] === 255 && pixels[i + 2] === 0) green++;
    return { x: rect.left + c.x + 25, y: rect.top + c.y + 15, green, opacity: getComputedStyle(engine.container).opacity };
  });
  assert.ok(point.green > 200); assert.equal(point.opacity, '0.4');
  await page.mouse.move(point.x, point.y);
  await page.waitForFunction(() => engine.hovered?.id === 'restored-emoji');
  await page.mouse.move(point.x, point.y + 100);
  await page.waitForFunction(() => !engine.hovered);
  assert.equal(await page.evaluate(() => engine.active[0].time), 55);
});

test('playing seek survives native restart and restored comments continue without duplicate entry', async () => {
  await page.evaluate(() => {
    seed([comment('restored', { start: 55000 }), comment('next', { start: 61000 })]);
    media.paused = false; engine.play();
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    engine.main.data = []; engine.stop();
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
    engine.clear(); engine.stop(); engine.start();
  });
  await page.waitForFunction(() => !engine.seekTask && engine.active.some(c => c.id === 'restored'));
  const result = await page.evaluate(() => {
    const restored = engine.active.find(c => c.id === 'restored');
    const before = restored.x;
    const running = engine.renderer.entries.get(restored).animation.playState;
    engine.updateComments([comment('restored', { start: 55000 })], false);
    advance(62);
    const after = restored.x;
    const ids = engine.active.map(c => c.id);
    // advance() only changes the fake media clock; also finish the real animation.
    engine.renderer.entries.get(restored).animation.finish();
    advance(70);
    return { before, after, running, ids, expired: !engine.active.some(c => c.id === 'restored') };
  });
  assert.equal(result.running, 'running'); assert.ok(result.after < result.before);
  assert.deepEqual(result.ids, ['restored', 'next']); assert.ok(result.expired);
});

test('dense seek prepares hidden sprites and publishes the entire snapshot together', async () => {
  const result = await page.evaluate(() => {
    seed(Array.from({ length: 960 }, (_, i) => comment(String(i), { start: 45610 + i * 15 })));
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; engine.seekCycle = false;
    const clock = performance.now.bind(performance);
    let cost = 0;
    performance.now = () => { cost += 0.3; return cost; };
    const partial = [];
    let passes = 0;
    do {
      engine.frame(); passes++;
      const visible = [...engine.renderer.entries.values()].filter(entry => getComputedStyle(entry.node).visibility !== 'hidden').length;
      if (engine.hasRestoreWork()) partial.push(visible);
    } while (engine.hasRestoreWork() && passes < 1000);
    performance.now = clock;
    const visible = [...engine.renderer.entries.values()].filter(entry => getComputedStyle(entry.node).visibility !== 'hidden').length;
    return { passes, partial, visible, active: engine.active.length };
  });
  assert.ok(result.passes > 1 && result.passes < 1000);
  assert.ok(result.partial.every(visible => visible === 0), 'Incomplete seek snapshots must not be visible');
  assert.ok(result.visible > 20); assert.equal(result.visible, result.active);
});

test('busy 4x playback with coarse media samples does not repeatedly hard-seek the animation', async () => {
  const result = await page.evaluate(async () => {
    seed([comment('smooth')]); advance(2);
    media.playbackRate = 4; media.paused = false;
    const origin = performance.now();
    Object.defineProperty(media, 'currentTime', { configurable: true, get: () => 2 + Math.floor((performance.now() - origin) / 100) * 0.4 });
    engine.play();
    const entry = engine.renderer.entries.get(engine.active[0]);
    await entry.animation.ready;
    const syncs = engine.metrics.animationSyncs;
    const times = [];
    for (let i = 0; i < 12; i++) {
      await new Promise(resolve => requestAnimationFrame(resolve));
      const end = performance.now() + 35;
      while (performance.now() < end) { /* Deliberately emulate page work. */ }
      engine.draw();
      times.push(Number(entry.animation.currentTime));
    }
    const extraSyncs = engine.metrics.animationSyncs - syncs;
    engine.pause();
    return { extraSyncs, times };
  });
  assert.equal(result.extraSyncs, 0, 'Steady playback must not rewrite animation.currentTime');
  assert.ok(result.times.every((time, i) => !i || time >= result.times[i - 1]));
  assert.ok(result.times.at(-1) - result.times[0] > 1000);
});

test('repeated native rate settings retain animation phase and moving hover uses displayed position', async () => {
  const result = await page.evaluate(async () => {
    seed([comment('phase')]); advance(2);
    media.playbackRate = 4; media.paused = false;
    const origin = performance.now();
    Object.defineProperty(media, 'currentTime', { configurable: true, get: () => 2 + Math.floor((performance.now() - origin) / 200) * 0.8 });
    engine.play();
    const c = engine.active[0], entry = engine.renderer.entries.get(c);
    const animation = entry.animation;
    const syncs = engine.metrics.animationSyncs;
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 35));
      engine.setAllDuration('scroll', 14400 / 4);
    }
    const unchanged = animation === entry.animation && engine.metrics.animationSyncs === syncs;
    const bounds = entry.node.getBoundingClientRect();
    const progress = Number(entry.animation.currentTime) / (c.duration * 1000);
    engine.hitTest({ clientX: bounds.left + 25, clientY: bounds.top + 15 });
    return { unchanged, hovered: engine.hovered === c, before: progress, frozen: c.frozenProgress };
  });
  assert.ok(result.unchanged); assert.ok(result.hovered);
  assert.ok(Math.abs(result.before - result.frozen) < 0.001);
});

test('sprites created across a busy task share a common animation phase', async () => {
  const result = await page.evaluate(() => {
    seed([comment('a'), comment('b')]); advance(2);
    engine.renderer.clear();
    const sampledAt = performance.now();
    engine.renderer.render(engine.active[0], engine.width, engine.progress(engine.active[0]), true, 4, false, sampledAt);
    const end = performance.now() + 50;
    while (performance.now() < end) { /* Simulate expensive batch preparation. */ }
    engine.renderer.render(engine.active[1], engine.width, engine.progress(engine.active[1]), true, 4, false, sampledAt);
    return engine.active.map(c => engine.renderer.entries.get(c).animation.startTime);
  });
  assert.ok(Math.abs(result[0] - result[1]) < 0.001);
});

test('actual video playback stays monotonic through 2x and 4x rates under page work', async () => {
  const result = await page.evaluate(async () => {
    engine.destroy();
    const source = document.createElement('canvas'); source.width = 160; source.height = 90;
    const ctx = source.getContext('2d');
    const stream = source.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    let frame = 0;
    const paint = setInterval(() => { ctx.fillStyle = frame++ % 2 ? '#274431' : '#476f54'; ctx.fillRect(0, 0, 160, 90); }, 30);
    recorder.start();
    await new Promise(resolve => setTimeout(resolve, 3500));
    recorder.stop(); await stopped;
    clearInterval(paint); stream.getTracks().forEach(track => track.stop());
    const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
    const video = document.createElement('video'); video.muted = true; video.src = url;
    document.querySelector('#player').prepend(video);
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    const results = [];
    try {
      for (const rate of [2, 4]) {
        video.pause();
        if (video.currentTime !== 0) { video.currentTime = 0; await new Promise(resolve => video.addEventListener('seeked', resolve, { once: true })); }
        video.playbackRate = 1;
        window.engine = new Engine.CanvasDanmu({ container: document.querySelector('#overlay'), player: video, defaultOff: true, comments: [comment('video', { duration: 14400 })] });
        engine.start(); await video.play();
        await new Promise(resolve => setTimeout(resolve, 100));
        video.playbackRate = rate;
        engine.setAllDuration('scroll', 14400 / rate);
        const c = engine.active[0], entry = engine.renderer.entries.get(c);
        await entry.animation.ready;
        const beforeSyncs = engine.metrics.animationSyncs;
        const samples = [];
        const until = performance.now() + 500;
        do {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const end = performance.now() + 12;
          while (performance.now() < end) { /* Simulate other player work. */ }
          engine.draw();
          samples.push({ x: new DOMMatrix(getComputedStyle(entry.node).transform).m41, time: video.currentTime });
        } while (performance.now() < until);
        results.push({ rate, samples, syncs: engine.metrics.animationSyncs - beforeSyncs, actualRate: entry.animation.playbackRate });
        video.pause(); engine.destroy();
      }
      return results;
    } finally { video.pause(); engine.destroy(); video.remove(); URL.revokeObjectURL(url); }
  });
  for (const run of result) {
    assert.equal(run.actualRate, run.rate); assert.equal(run.syncs, 0);
    assert.ok(run.samples.at(-1).time - run.samples[0].time > 0.5);
    assert.ok(run.samples.every((sample, i) => !i || sample.x <= run.samples[i - 1].x + 0.01));
    assert.ok(run.samples[0].x - run.samples.at(-1).x > 40);
  }
});

test('late seek batches publish together without resynchronizing already visible animations', async () => {
  await page.evaluate(() => {
    seed([comment('published', { start: 55000 })]);
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => !engine.seekTask && !engine.hasRestoreWork());
  const result = await page.evaluate(() => {
    media.paused = false; media.playbackRate = 4; engine.play();
    const published = engine.active[0], entry = engine.renderer.entries.get(published);
    const startTime = entry.animation.startTime;
    engine.updateComments(Array.from({ length: 100 }, (_, i) => comment('late' + i, { start: 50000 + i * 50 })), false);
    engine.cancel(); engine.draw();
    const anchor = entry.animation.startTime;
    const clock = performance.now.bind(performance);
    let cost = 0, passes = 0, partial = 0;
    performance.now = () => { cost += 0.3; return cost; };
    do {
      engine.frame(); passes++;
      if (engine.hasRestoreWork()) partial += engine.active.filter(c => c !== published && !c.staged).length;
    } while (engine.hasRestoreWork() && passes < 1000);
    performance.now = clock;
    return { partial, passes, unchanged: anchor === entry.animation.startTime, visible: engine.active.filter(c => !c.staged).length, startTime };
  });
  assert.ok(result.passes > 1 && result.passes < 1000);
  assert.equal(result.partial, 0); assert.ok(result.unchanged); assert.ok(result.visible > 1);
});

test('seek snapshot catches up with playback before publishing new historical positions', async () => {
  const result = await page.evaluate(() => {
    seed([...Array.from({ length: 100 }, (_, i) => comment(String(i), { start: 53000 + i * 50 })), comment('during-restore', { start: 60500 })]);
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; engine.seekCycle = false;
    const clock = performance.now.bind(performance);
    let cost = 0, passes = 0;
    performance.now = () => { cost += 0.3; return cost; };
    engine.frame();
    const partial = engine.hasRestoreWork();
    media.currentTime = 61;
    while (engine.hasRestoreWork() && passes++ < 1000) engine.frame();
    performance.now = clock;
    const c = engine.active.find(c => c.id === 'during-restore');
    return { partial, finished: !engine.hasRestoreWork(), visible: !!c && !c.staged, start: c?.time, x: c?.x, width: engine.width };
  });
  assert.ok(result.partial); assert.ok(result.finished); assert.ok(result.visible);
  assert.equal(result.start, 60.5); assert.ok(result.x < result.width);
});

test('pausing during reconstruction still finishes and stopping cancels queued tasks', async () => {
  await page.evaluate(() => {
    seed(Array.from({ length: 960 }, (_, i) => comment(String(i), { start: 45610 + i * 15 })));
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; engine.seekCycle = false;
    const clock = performance.now.bind(performance);
    let cost = 0;
    performance.now = () => { cost += 0.3; return cost; };
    engine.frame();
    performance.now = clock;
    media.paused = true; media.dispatchEvent(new Event('pause'));
  });
  await page.waitForFunction(() => !engine.hasRestoreWork());
  const result = await page.evaluate(async () => {
    const visible = engine.active.filter(c => !c.staged).length;
    const paused = [...engine.renderer.entries.values()].every(entry => entry.animation.playState === 'paused');
    engine.resetFrame(true); engine.wake();
    const scheduled = !!engine.restoreTask;
    engine.stop();
    const callbacks = engine.metrics.schedulerCallbacks;
    await new Promise(resolve => setTimeout(resolve, 25));
    const stopped = !engine.restoreTask && !engine.active.length && callbacks === engine.metrics.schedulerCallbacks;
    engine.destroy();
    return { visible, paused, scheduled, stopped, released: engine.restoreChannel === null };
  });
  assert.ok(result.visible > 20); assert.ok(result.paused); assert.ok(result.scheduled);
  assert.ok(result.stopped); assert.ok(result.released);
});

test('replacement network batches retain unprepared comments in a seek snapshot', async () => {
  const result = await page.evaluate(() => {
    const items = Array.from({ length: 100 }, (_, i) => comment(String(i), { start: 53000 + i * 50 }));
    seed(items);
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; engine.seekCycle = false;
    const clock = performance.now.bind(performance);
    let cost = 0, passes = 0;
    performance.now = () => { cost += 0.3; return cost; };
    engine.frame();
    const unprepared = engine.restoreQueue.length - engine.restoreHead;
    engine.updateComments(items, true);
    while (engine.hasRestoreWork() && passes++ < 1000) engine.frame();
    performance.now = clock;
    const ids = [...engine.active, ...engine.pending.slice(engine.pendingHead)].map(c => c.id);
    return { unprepared, count: ids.length, unique: new Set(ids).size };
  });
  assert.ok(result.unprepared > 0); assert.equal(result.count, 100); assert.equal(result.unique, 100);
});

test('accelerated comments finish their visible flight before being removed', async () => {
  const result = await page.evaluate(async () => {
    const runs = [];
    for (const rate of [2, 3, 4]) {
      engine.stop(); engine.clear();
      media.playbackRate = rate;
      engine.setAllDuration('scroll', 3000 / rate);
      let origin;
      Object.defineProperty(media, 'currentTime', { configurable: true, get: () => origin == null ? 0 : (performance.now() - origin) * rate / 1000 });
      engine.resetFrame(false);
      media.paused = false;
      const removed = [];
      const record = ({ bullet }) => {
        const entry = engine.renderer.entries.get(bullet);
        removed.push({ id: bullet.id, progress: engine.renderer.progress(bullet),
          x: new DOMMatrix(getComputedStyle(entry.node).transform).m41, width: bullet.width, rate: entry.animation.playbackRate });
      };
      engine.on('bullet_remove', record);
      engine.updateComments(Array.from({ length: 20 }, (_, i) => comment('flight' + i, { start: i * 80, duration: 3000 / rate })), true);
      origin = performance.now();
      engine.start();
      await new Promise(resolve => setTimeout(resolve, 5000 / rate));
      engine.pause(); engine.off('bullet_remove', record);
      runs.push({ rate, removed });
    }
    return runs;
  });
  for (const { rate, removed } of result) {
    assert.equal(removed.length, 20, JSON.stringify({ rate, removed }));
    assert.ok(removed.every(c => c.rate === rate), JSON.stringify({ rate, removed }));
    assert.ok(removed.every(c => c.x + c.width < 1), JSON.stringify({ rate, removed }));
  }
});

test('delayed native seek cleanup preserves the target snapshot and cached history', async () => {
  await page.evaluate(() => {
    seed(Array.from({ length: 12 }, (_, i) => comment('cached' + i, { start: (48 + i) * 1000 })));
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => !engine.seekTask && !engine.hasRestoreWork());
  await page.evaluate(() => {
    engine.main.data = [];
    engine.clear(); engine.stop(); engine.start(); engine.pause();
  });
  await page.waitForFunction(() => !engine.hasRestoreWork());
  const result = await page.evaluate(() => ({ count: engine.active.length, cached: engine.timeline.items.length,
    left: engine.active.some(c => c.x < 250), right: engine.active.some(c => c.x > 750) }));
  assert.equal(result.count, 12); assert.equal(result.cached, 12); assert.ok(result.left && result.right);
});

test('late responses after an empty seek restore comments newer than the original seek target', async () => {
  await page.evaluate(() => {
    seed([]);
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => !engine.seekTask && !engine.hasRestoreWork());
  await page.evaluate(() => {
    media.currentTime = 64;
    engine.updateComments([comment('late-new', { start: 61000 }), comment('late-priority', { start: 62000, prior: true })], false);
  });
  await page.waitForFunction(() => !engine.hasRestoreWork());
  const result = await page.evaluate(() => {
    const c = engine.active.find(c => c.id === 'late-new');
    const priority = engine.active.find(c => c.id === 'late-priority');
    return { time: c?.time, x: c?.x, priorityTime: priority?.time, priorityX: priority?.x };
  });
  assert.equal(result.time, 61); assert.ok(result.x < 850);
  assert.equal(result.priorityTime, 62); assert.ok(result.priorityX < 900);
});

test('visible comments are not retired while the compositor still has half a flight left', async () => {
  const result = await page.evaluate(async () => {
    seed([comment('drift')]); advance(2);
    media.paused = false; media.playbackRate = 4; engine.play();
    const c = engine.active[0], entry = engine.renderer.entries.get(c);
    await entry.animation.ready;
    // Model a delayed animation clock after a browser rendering interruption.
    entry.animation.currentTime = c.duration * 500;
    media.currentTime = c.time + c.duration + 0.1;
    engine.frame();
    const retained = engine.active.includes(c) && entry.node.isConnected;
    entry.animation.finish();
    engine.frame();
    return { retained, removed: !engine.active.includes(c) };
  });
  assert.ok(result.retained); assert.ok(result.removed);
});

test('retained visible flights still block colliding comments after the media expiry time', async () => {
  const result = await page.evaluate(async () => {
    engine.setArea({ lines: 1 });
    seed([comment('leader', { text: 'Wide leader '.repeat(8) })]);
    advance(2);
    media.paused = false; media.playbackRate = 4; engine.play();
    const c = engine.active[0], entry = engine.renderer.entries.get(c);
    await entry.animation.ready;
    entry.animation.currentTime = c.duration * 500;
    media.currentTime = c.time + c.duration + 0.1;
    engine.sendComment(comment('follower', { text: 'Wide follower '.repeat(8), realTime: true }));
    return { active: engine.active.map(c => c.id), pending: engine.pending.slice(engine.pendingHead).map(c => c.id) };
  });
  assert.deepEqual(result.active, ['leader']); assert.deepEqual(result.pending, ['follower']);
});

test('seek history survives closing and reopening but is released when the video changes', async () => {
  await page.evaluate(() => {
    seed([comment('history', { start: 55000 })]);
    media.currentTime = 60; media.seeking = true; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
  });
  await page.waitForFunction(() => !engine.seekTask && !engine.hasRestoreWork());
  await page.evaluate(() => { engine.stop(); media.currentTime = 62; engine.start(); engine.pause(); });
  await page.waitForFunction(() => !engine.hasRestoreWork());
  const result = await page.evaluate(() => {
    const restored = engine.active.some(c => c.id === 'history' && c.time === 55 && c.x < 600);
    media.dispatchEvent(new Event('emptied'));
    return { restored, data: engine.timeline.items.length, active: engine.active.length, restoreTime: engine.restoreTime };
  });
  assert.ok(result.restored); assert.equal(result.data, 0); assert.equal(result.active, 0); assert.equal(result.restoreTime, null);
});
