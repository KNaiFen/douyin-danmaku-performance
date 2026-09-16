import test from 'node:test';
import assert from 'node:assert/strict';
import { installHook } from '../src/hook.js';

function fixtureFactory() {
  return new Function('module', `/* updateComments setFontSize readDataV1 bulletCreateEl ${' '.repeat(30000)} */
    module.exports = class Original { updateComments() {} };`);
}
function boot(scope) {
  const factories = {};
  const cache = {};
  function require(id) {
    if (!cache[id]) { cache[id] = { exports: {} }; factories[id](cache[id], cache[id].exports, require); }
    return cache[id].exports;
  }
  const array = scope.webpackChunkdouyin_web;
  function accept(parent, chunk) { Object.assign(factories, chunk[1]); chunk[2]?.(require); return parent?.(chunk); }
  array.forEach(chunk => accept(null, chunk));
  array.push = accept.bind(null, array.push.bind(array));
  return require;
}
function diagnostic() { return { modules: [], replaced: 0, fallbacks: 0, incompatible: 0 }; }

test('hooks late chunks after runtime overwrites push without recursive dispatch', () => {
  const scope = {};
  const stats = diagnostic();
  class Replacement {}
  installHook(scope, Replacement, stats);
  const require = boot(scope);
  scope.webpackChunkdouyin_web.push([[1], { 150486: fixtureFactory() }]);
  assert.ok(new (require(150486))() instanceof Replacement);
  scope.webpackChunkdouyin_web.push([[2], { 42: m => { m.exports = 'untouched'; } }]);
  assert.equal(require(42), 'untouched');
  assert.equal(scope.webpackChunkdouyin_web.length, 2);
  assert.equal(stats.replaced, 1);
});

test('hooks already queued chunks and a reassigned chunk array', () => {
  const scope = { webpackChunkdouyin_web: [[[1], { 150486: fixtureFactory() }]] };
  const stats = diagnostic();
  class Replacement {}
  installHook(scope, Replacement, stats);
  assert.ok(new (boot(scope)(150486))() instanceof Replacement);
  scope.webpackChunkdouyin_web = [[[2], { 987654: fixtureFactory() }]];
  assert.ok(new (boot(scope)(987654))() instanceof Replacement);
  assert.deepEqual(stats.modules, ['150486', '987654']);
});

test('constructor failure returns a working original instead of losing danmaku', () => {
  const scope = {};
  const stats = diagnostic();
  installHook(scope, class Broken { constructor() { throw new Error('unsupported'); } }, stats);
  const require = boot(scope);
  scope.webpackChunkdouyin_web.push([[1], { 150486: fixtureFactory() }]);
  assert.equal(new (require(150486))().constructor.name, 'Original');
  assert.equal(stats.fallbacks, 1);
});
