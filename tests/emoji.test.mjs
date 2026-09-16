import test from 'node:test';
import assert from 'node:assert/strict';
import { splitEmoji, formatDiggCount } from '../src/emoji.js';

const map = new Map([['[smile]', 'https://example.com/smile.png'], ['[cry]', 'https://example.com/cry.png']]);

test('splits adjacent and mixed Douyin emoji using the native Map', () => {
  assert.deepEqual(splitEmoji('a[smile][cry]b', map), [
    { text: 'a' }, { text: '[smile]', url: map.get('[smile]') },
    { text: '[cry]', url: map.get('[cry]') }, { text: 'b' },
  ]);
});

test('native high-digg counter uses ten-thousand notation', () => {
  assert.equal(formatDiggCount(9999), '9999');
  assert.equal(formatDiggCount(12500), '1.3\u4e07');
  assert.equal(formatDiggCount(undefined), '0');
});

test('unknown emoji, malformed brackets and normal Unicode text remain intact', () => {
  assert.deepEqual(splitEmoji('a[unknown]b [unfinished', map), [{ text: 'a[unknown]b [unfinished' }]);
  assert.deepEqual(splitEmoji('[outer[smile]', map), [{ text: '[outer' }, { text: '[smile]', url: map.get('[smile]') }]);
  assert.deepEqual(splitEmoji('hello', undefined), [{ text: 'hello' }]);
  assert.deepEqual(splitEmoji('[smile]', new Map([['[smile]', 'javascript:bad']])) , [{ text: '[smile]' }]);
});
