import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { sha256 } from './asar.js';

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8' };

/** Browser feasibility host, not a replacement UI or an upstream relay. */
export async function createAssetHost(root: string) {
  root = resolve(root);
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  const files = new Map<string, { path: string; hash: string }>();
  for (const [path, hash] of Object.entries(manifest.files)) {
    if (!path.startsWith('webview/') || path.split('/').some(p => p === '..' || p === '.') || path.includes('\\')) throw Error('Invalid asset manifest path');
    files.set('/' + path.slice('webview/'.length), { path, hash: String(hash) });
  }
  for (const [path, hash] of Object.entries(manifest.generatedFiles ?? {})) {
    if (!['standalone.html', 'bridge.js', 'wire.js', 'THIRD_PARTY_NOTICES.txt'].includes(path)) throw Error('Invalid generated manifest path');
    files.set('/' + path, { path, hash: String(hash) });
  }
  for (const patch of manifest.patches ?? []) {
    if (!files.has('/' + patch.path.slice(8)) || patch.generatedPath !== `patched/${patch.path}` || patch.path.includes('..')) throw Error('Invalid patch path');
    files.set('/' + patch.path.slice(8), { path: patch.generatedPath, hash: patch.outputSha256 });
  }
  const entry = files.get('/standalone.html');
  if (!entry || !files.has('/bridge.js')) throw Error('Assets need preparation: run npm run assets:prepare');
  // Validate entry and bridge before listening. Other assets are verified on access.
  for (const path of ['/standalone.html', '/bridge.js']) {
    const file = files.get(path)!;
    if (sha256(await readFile(resolve(root, file.path))) !== file.hash) throw Error(`Asset integrity mismatch: ${path}`);
  }
  return createServer(async (request, response) => {
    const send = (code: number, body: string) => { response.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(request.method === 'HEAD' ? undefined : body); };
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.setHeader('Allow', 'GET, HEAD'); send(405, 'Method not allowed'); return; }
    let path: string;
    try { path = decodeURIComponent((request.url ?? '/').split('?')[0]); }
    catch { send(400, 'Invalid URL'); return; }
    if (!path.startsWith('/') || path.includes('\\') || path.includes('\0') || path.split('/').some(p => p === '..' || p === '.')) { send(400, 'Invalid path'); return; }
    if (path === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify({ proofGate: 'not-passed', rendererServices: 'unavailable' })); return;
    }
    let file = path === '/' || path === '/index.html' ? entry : files.get(path);
    // Missing chunks must be 404, never HTML. SPA fallback is for document routes.
    if (!file && request.headers.accept?.includes('text/html') && !extname(path) && !path.startsWith('/assets/')) file = entry;
    if (!file) { send(404, 'Not found'); return; }
    try {
      const data = await readFile(resolve(root, file.path));
      if (sha256(data) !== file.hash) { send(503, 'Asset integrity mismatch; prepare assets again'); return; }
      const etag = `"${file.hash}"`;
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'no-cache');
      response.setHeader('ETag', etag);
      if (request.headers['if-none-match'] === etag) { response.writeHead(304); response.end(); return; }
      response.writeHead(200, { 'Content-Type': types[extname(file.path)] ?? 'application/octet-stream', 'Content-Length': data.length });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { if (!response.headersSent) send(503, 'Prepared asset unavailable'); else response.destroy(); }
  });
}
