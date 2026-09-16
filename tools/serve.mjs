import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const port = Number(process.env.PORT || 8765);
const allowed = new Map([
  ['/', ['tests/browser.html', 'text/html; charset=utf-8']],
  ['/engine.js', ['output/engine.js', 'text/javascript; charset=utf-8']],
  ['/userscript.js', ['douyin-danmaku-performance.user.js', 'text/javascript; charset=utf-8']],
  ['/original.js', ['.materials/douyin-engine.js', 'text/javascript; charset=utf-8']],
]);
http.createServer(async (request, response) => {
  const file = allowed.get(new URL(request.url, 'http://localhost').pathname);
  if (!file) { response.writeHead(404).end(); return; }
  try { response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' }); response.end(await fs.readFile(path.join(root, file[0]))); }
  catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
