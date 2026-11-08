import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { createAssetHost } from '../src/asset-host.js';
import { sha256 } from '../src/asar.js';

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'webui-assets-'));
  await mkdir(join(root, 'webview/assets/async'), { recursive: true });
  const entry = '<html><script src="/bridge.js"></script><script src="/assets/async/chunk.js"></script></html>';
  await writeFile(join(root, 'standalone.html'), entry);
  await writeFile(join(root, 'bridge.js'), '// bridge');
  await writeFile(join(root, 'webview/assets/async/chunk.js'), '// chunk');
  await writeFile(join(root, 'private.txt'), 'secret');
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ files: { 'webview/assets/async/chunk.js': sha256('// chunk') }, generatedFiles: { 'standalone.html': sha256(entry), 'bridge.js': sha256('// bridge') } }));
  const server = await createAssetHost(root);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address() as any;
  const url = `http://127.0.0.1:${address.port}`;
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  return { root, url };
}
test('serves independent browser requests, SPA routes, lazy chunks, and explicit health state', async t => {
  const { url } = await fixture(t);
  const pages = await Promise.all([fetch(url), fetch(url + '/codex/thread/123', { headers: { accept: 'text/html' } })]);
  assert.equal(await pages[0].text(), await pages[1].text());
  const chunk = await fetch(url + '/assets/async/chunk.js');
  assert.match(chunk.headers.get('content-type')!, /javascript/);
  assert.equal(await chunk.text(), '// chunk');
  const cached = await fetch(url + '/assets/async/chunk.js', { headers: { 'if-none-match': chunk.headers.get('etag')! } });
  assert.equal(cached.status, 304);
  const health = await (await fetch(url + '/healthz')).json();
  assert.equal(health.proofGate, 'not-passed');
});
test('missing assets and private files never fall back to HTML', async t => {
  const { url } = await fixture(t);
  for (const path of ['/private.txt', '/assets/async/missing.js', '/assets/missing']) {
    assert.equal((await fetch(url + path, { headers: { accept: 'text/html' } })).status, 404);
  }
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  assert.equal((await fetch(url, { method: 'HEAD' })).headers.get('content-type'), 'text/html; charset=utf-8');
});
test('rejects raw traversal and malformed encoding', async t => {
  const { url } = await fixture(t);
  for (const path of ['/%2e%2e/private.txt', '/%ZZ', '/assets%5cprivate.txt']) {
    const status = await new Promise<number>(resolve => {
      const req = request(url + '/', { path }, res => { res.resume(); resolve(res.statusCode!); }); req.end();
    });
    assert.equal(status, 400);
  }
});
test('fails closed on modified lazy assets or a changed startup bridge', async t => {
  const { root, url } = await fixture(t);
  await writeFile(join(root, 'webview/assets/async/chunk.js'), '// modified');
  assert.equal((await fetch(url + '/assets/async/chunk.js')).status, 503);
  await writeFile(join(root, 'bridge.js'), '// modified');
  await assert.rejects(createAssetHost(root), /integrity mismatch/);
});
