import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Archive } from '../src/asar.js';

async function fixture(tree: unknown, payload: Buffer, run: (path: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'webui-asar-'));
  const json = Buffer.from(JSON.stringify(tree));
  const padded = Math.ceil((json.length + 4) / 4) * 4;
  const prefix = Buffer.alloc(16);
  prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(padded + 4, 4);
  prefix.writeUInt32LE(padded, 8); prefix.writeUInt32LE(json.length, 12);
  const header = Buffer.alloc(padded - 4); json.copy(header);
  const path = join(dir, 'fixture.asar');
  try { await writeFile(path, Buffer.concat([prefix, header, payload])); await run(path); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
test('reads ASAR extents and preserves binary assets', async () => {
  const payload = Buffer.from([0, 255, 16, 42]);
  await fixture({ files: { webview: { files: { 'font.woff': { offset: '0', size: 4 } } } } }, payload, async path => {
    const archive = await Archive.open(path);
    assert.deepEqual(archive.entries(), ['webview/font.woff']);
    assert.deepEqual(await archive.read('webview/font.woff'), payload);
    await assert.rejects(archive.read('../webview/font.woff'), /Unsafe/);
  });
});
test('rejects truncated archives and unsafe entries', async () => {
  await fixture({ files: { asset: { offset: '0', size: 10 } } }, Buffer.alloc(0), async path => {
    await assert.rejects((await Archive.open(path)).read('asset'), /Truncated/);
  });
  await fixture({ files: { '..': { offset: '0', size: 0 } } }, Buffer.alloc(0), async path => {
    const archive = await Archive.open(path);
    assert.throws(() => archive.entries(), /Unsafe/);
  });
});
