import test from 'node:test';
import assert from 'node:assert/strict';
import { Timeline, lowerBound } from '../src/timeline.js';

test('normalizes milliseconds, preserves zero, merges without dropping text', () => {
  const timeline = new Timeline();
  timeline.update([{ id: 'b', start: 2000, text: 'B' }, { id: 'a', start: 0, text: 'A' }], true, 20);
  timeline.update([{ id: 'c', text: '[smile]' }, { id: 'b', start: 2000, text: 'updated' }], false, 20);
  assert.deepEqual(timeline.items.map(c => [c.id, c.time, c.text]), [['a', 0, 'A'], ['b', 2, 'updated'], ['c', 20, '[smile]']]);
});

test('seek finds first target timestamp in a large timeline', () => {
  const values = Array.from({ length: 100000 }, (_, time) => ({ time: time / 10 }));
  let reads = 0;
  const observed = new Proxy(values, { get(target, key) { if (key !== 'length') reads++; return target[key]; } });
  assert.equal(lowerBound(observed, 7777.7), 77777);
  assert.ok(reads < 20);
  assert.equal(lowerBound(values, -1), 0);
  assert.equal(lowerBound(values, 10000), 100000);
});

test('clear removes prior-video data and malformed times cannot poison ordering', () => {
  const timeline = new Timeline();
  timeline.update([{ id: 'old', start: 10, text: 'old' }], true, 0);
  timeline.update([{ id: 'new', start: 20, txt: 'new' }, { id: 'invalid', start: NaN, text: 'bad' }], true, 0);
  assert.deepEqual(timeline.items.map(c => c.id), ['new']);
  timeline.remove('new');
  assert.equal(timeline.items.length, 0);
  assert.equal(timeline.ids.size, 0);
});

test('realtime posts use current time and ID changes retain the same item', () => {
  const timeline = new Timeline();
  timeline.update([{ id: 'local', start: 900000, realTime: true, text: 'post' }], true, 10);
  const item = timeline.items[0];
  assert.equal(item.time, 10);
  assert.equal(timeline.rename('local', 'server'), true);
  assert.equal(timeline.ids.get('server'), item);
  assert.equal(item.raw.id, 'server');
  assert.equal(timeline.ids.has('local'), false);
});

test('acknowledgement merges an earlier server echo into the local post', () => {
  const timeline = new Timeline();
  timeline.update([{ id: 'local', realTime: true, text: 'post' }, { id: 'server', text: 'post' }], true, 10);
  const local = timeline.ids.get('local');
  assert.equal(timeline.rename('local', 'server'), true);
  assert.deepEqual(timeline.items, [local]);
  assert.equal(timeline.ids.size, 1); assert.equal(local.raw.id, 'server');
});
