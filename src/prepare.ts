import { mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { patchRenderer } from './renderer-patch.js';
import { Archive, hashFile, sha256 } from './asar.js';

const archivePath = resolve(process.argv[2] ?? 'chatgpt/usr/lib/chatgpt/resources/app.asar');
const output = resolve('.generated');
const archive = await Archive.open(archivePath);
await mkdir(output, { recursive: true });
await rm(resolve(output, 'module-index.json'), { force: true });
const packageInfo = JSON.parse((await archive.read('package.json')).toString());
const entries = archive.entries().filter(path => path.startsWith('webview/'));
const files: Record<string, string> = {};
for (const path of entries) {
  const data = await archive.read(path);
  files[path] = sha256(data);
  const target = resolve(output, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
}
await copyFile(resolve(dirname(archivePath), 'THIRD_PARTY_NOTICES.txt'), resolve(output, 'THIRD_PARTY_NOTICES.txt'));
const html = (await readFile(resolve(output, 'webview/index.html'))).toString();
// Only the separate entry is adapted; extracted vendor files remain byte-identical.
const standalone = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/i, '')
  .replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:">\n<script type="module" src="/bridge.js"></script>`);
await writeFile(resolve(output, 'standalone.html'), standalone);
await copyFile(resolve('dist/src/browser-bridge.js'), resolve(output, 'bridge.js'));
await copyFile(resolve('dist/src/wire.js'), resolve(output, 'wire.js'));
await copyFile(resolve('dist/src/rpc-channel.js'), resolve(output, 'rpc-channel.js'));
const pin = JSON.parse(await readFile('compatibility/renderer-auth.json', 'utf8'));
const patched = patchRenderer(await readFile(resolve(output, pin.path), 'utf8'), pin);
await mkdir(dirname(resolve(output, patched.record.generatedPath)), { recursive: true });
await writeFile(resolve(output, patched.record.generatedPath), patched.output);
const manifest = { schemaVersion: 1, archiveSha256: await hashFile(archivePath), applicationVersion: packageInfo.version,
  modules: { manager: { id: 'V7mA', export: 'O3' }, rpc: { id: 'Fkn8' }, persistedRecord: { id: 'waIq', export: 'm' } }, files,
  generatedFiles: { 'rpc-channel.js': sha256(await readFile(resolve(output, 'rpc-channel.js'))), 'wire.js': sha256(await readFile(resolve(output, 'wire.js'))), 'standalone.html': sha256(standalone), 'bridge.js': sha256(await readFile(resolve(output, 'bridge.js'))),
    'THIRD_PARTY_NOTICES.txt': sha256(await readFile(resolve(output, 'THIRD_PARTY_NOTICES.txt'))) },
  patches: [patched.record], entry: { originalSha256: files['webview/index.html'], generatedSha256: sha256(standalone) } };
await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Prepared ${entries.length} unchanged renderer assets for ${packageInfo.version}.`);
