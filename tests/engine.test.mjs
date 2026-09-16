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
  const result = await page.evaluate(() => {
    seed(Array.from({ length: 5000 }, (_, i) => comment(String(i))));
    const backlog = engine.pending.length - engine.pendingHead;
    media.dispatchEvent(new Event('waiting'));
    media.seeking = true; media.currentTime = 60; media.dispatchEvent(new Event('seeking'));
    media.seeking = false; media.dispatchEvent(new Event('seeked'));
    engine.updateComments([comment('target', { start: 60000 })], false); engine.frame();
    media.paused = false; engine.play(); media.dispatchEvent(new Event('canplay'));
    const recovered = !engine.buffering && !!engine.raf;
    const ids = engine.active.map(c => c.id);
    engine.destroy();
    return { backlog, recovered, ids, instances: Engine.instances.size, nodes: document.querySelector('#overlay').children.length, raf: engine.raf, bindings: engine.bindings.length };
  });
  assert.ok(result.backlog > 4000); assert.ok(result.recovered); assert.deepEqual(result.ids, ['target']);
  assert.equal(result.instances, 0); assert.equal(result.nodes, 0); assert.equal(result.raf, 0); assert.equal(result.bindings, 0);
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
