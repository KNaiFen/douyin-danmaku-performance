import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createDelivery, sendDelivery, run } from '../tools/greasyfork-sync.mjs';

const sha = 'a'.repeat(40);
const secret = 'test-only-secret';

test('webhook includes the script path and signs the exact UTF-8 body for both algorithms', () => {
  const request = createDelivery({ sha, message: 'Sync "quoted" version \u4e2d\u6587\nnext line' }, secret);
  const payload = JSON.parse(request.body);
  assert.equal(payload.ref, 'refs/heads/main');
  assert.equal(payload.repository.clone_url, 'https://github.com/KNaiFen/douyin-danmaku-performance.git');
  assert.equal(payload.commits[0].id, sha);
  assert.deepEqual(payload.commits[0].modified, ['douyin-danmaku-performance.user.js']);
  assert.equal(request.headers['X-GitHub-Event'], 'push');
  for (const [algorithm, header] of [['sha1', 'X-Hub-Signature'], ['sha256', 'X-Hub-Signature-256']]) {
    assert.equal(request.headers[header], `${algorithm}=${createHmac(algorithm, secret).update(request.body, 'utf8').digest('hex')}`);
  }
  assert.ok(!JSON.stringify(request).includes(secret));
  assert.throws(() => createDelivery({ sha, message: '' }, ''), /SECRET/);
  assert.throws(() => createDelivery({ sha: 'main', message: '' }, secret), /SHA/);
});

test('delivery only reports success after Greasy Fork confirms an updated script', async () => {
  const delivery = createDelivery({ sha, message: 'Sync' }, secret);
  const count = await sendDelivery(delivery, async (url, request) => {
    assert.equal(url, 'https://api.greasyfork.org/zh-CN/users/718827-knaifen/webhook');
    assert.equal(request.body, delivery.body);
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal instanceof AbortSignal);
    return Response.json({ updated_scripts: ['https://greasyfork.org/scripts/123'], updated_failed: [] });
  });
  assert.equal(count, 1);
  await assert.rejects(sendDelivery(delivery, async () => new Response('', { status: 403 })), /HTTP 403/);
  await assert.rejects(sendDelivery(delivery, async () => new Response('not JSON')), /JSON/);
  await assert.rejects(sendDelivery(delivery, async () => Response.json({})), /unexpected/);
  await assert.rejects(sendDelivery(delivery, async () => Response.json({ updated_scripts: [], updated_failed: [] })), /No matching script/);
  await assert.rejects(sendDelivery(delivery, async () => Response.json({ updated_scripts: ['one'], updated_failed: ['two'] })), /could not update/);
});

test('missing secret skips sending and non-main or foreign events are rejected', async () => {
  const env = { GITHUB_REPOSITORY: 'KNaiFen/douyin-danmaku-performance', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch' };
  await run(env);
  await assert.rejects(run({ ...env, GITHUB_REF: 'refs/heads/dev' }), /main branch/);
  await assert.rejects(run({ ...env, GITHUB_REPOSITORY: 'other/repository' }), /original repository/);
  await assert.rejects(run({ ...env, GITHUB_EVENT_NAME: 'pull_request' }), /push or manual/);
});
