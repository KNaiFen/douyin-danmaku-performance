import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const repository = 'KNaiFen/douyin-danmaku-performance';
const script = 'douyin-danmaku-performance.user.js';
const endpoint = 'https://api.greasyfork.org/zh-CN/users/718827-knaifen/webhook';

export function createDelivery({ sha, message }, secret) {
  if (!secret) throw new Error('GREASYFORK_WEBHOOK_SECRET is required.');
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Expected a full Git commit SHA.');
  // Actions omits commit.modified; Greasy Fork needs it to match the sync URL.
  const body = JSON.stringify({
    ref: 'refs/heads/main',
    after: sha,
    repository: {
      full_name: repository,
      html_url: `https://github.com/${repository}`,
      clone_url: `https://github.com/${repository}.git`,
      default_branch: 'main',
    },
    commits: [{ id: sha, message, added: [], modified: [script], removed: [] }],
  });
  const signature = algorithm => `${algorithm}=${createHmac(algorithm, secret).update(body).digest('hex')}`;
  return {
    method: 'POST',
    redirect: 'error',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'douyin-danmaku-performance-actions',
      'X-GitHub-Event': 'push',
      'X-GitHub-Delivery': randomUUID(),
      // Greasy Fork currently validates the legacy SHA-1 header.
      'X-Hub-Signature': signature('sha1'),
      'X-Hub-Signature-256': signature('sha256'),
    },
    body,
  };
}

export async function sendDelivery(delivery, fetcher = fetch) {
  const response = await fetcher(endpoint, { ...delivery, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Greasy Fork returned HTTP ${response.status}. Check the webhook secret and service availability.`);
  let result;
  try { result = await response.json(); }
  catch { throw new Error('Greasy Fork did not return a JSON sync result.'); }
  if (!Array.isArray(result?.updated_scripts) || !Array.isArray(result?.updated_failed)) {
    throw new Error('Greasy Fork returned an unexpected sync result.');
  }
  if (result.updated_failed.length) throw new Error('Greasy Fork could not update the script. Check its sync settings, version and validation errors.');
  if (!result.updated_scripts.length) throw new Error('No matching script was updated. Import the script on Greasy Fork and set its sync URL to the main branch Raw URL.');
  return result.updated_scripts.length;
}

export async function run(env = process.env) {
  if (env.GITHUB_REPOSITORY !== repository || env.GITHUB_REF !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error('This publisher only runs for push or manual events on the original repository main branch.');
  }
  const report = async message => {
    console.log(message);
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `${message}\n`);
  };
  if (!env.GREASYFORK_WEBHOOK_SECRET) {
    await report('Skipped: configure the GREASYFORK_WEBHOOK_SECRET repository Actions secret, then run this workflow manually. No webhook was sent.');
    return;
  }
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const source = await readFile(script, 'utf8');
  const version = source.match(/^\/\/\s*@version\s+(\S+)/m)?.[1];
  if (!version) throw new Error('The userscript has no @version metadata.');
  const delivery = createDelivery({ sha, message: `Sync userscript v${version} (${sha.slice(0, 7)})` }, env.GREASYFORK_WEBHOOK_SECRET);
  const count = await sendDelivery(delivery);
  await report(`Greasy Fork updated ${count} script(s) from main commit ${sha}, version ${version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
