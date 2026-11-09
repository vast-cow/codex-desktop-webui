import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { patchRenderer } from './renderer-patch.js';
import { hashFile } from './asar.js';
const manifest = JSON.parse(await readFile('.generated/manifest.json', 'utf8'));
const archive = resolve(process.argv[2] ?? 'chatgpt/usr/lib/chatgpt/resources/app.asar');
if (await hashFile(archive) !== manifest.archiveSha256) throw Error('Original archive hash mismatch');
for (const [path, hash] of Object.entries(manifest.files)) {
  if (await hashFile(resolve('.generated', path)) !== hash) throw Error(`Extracted asset mismatch: ${path}`);
}
for (const [path, hash] of Object.entries(manifest.generatedFiles ?? {})) {
  if (await hashFile(resolve('.generated', path)) !== hash) throw Error(`Generated asset mismatch: ${path}`);
}
for (const patch of manifest.patches ?? []) {
  if (await hashFile(resolve('.generated', patch.path)) !== patch.inputSha256) throw Error('Patch input mismatch');
  if (await hashFile(resolve('.generated', patch.generatedPath)) !== patch.outputSha256) throw Error('Patch output mismatch');
  const pin = JSON.parse(await readFile('compatibility/renderer-auth.json', 'utf8'));
  const expected = patchRenderer(await readFile(resolve('.generated', patch.path), 'utf8'), pin);
  if (expected.record.outputSha256 !== patch.outputSha256) throw Error('Stale generated renderer patch');
}
if (await hashFile('.generated/standalone.html') !== manifest.entry.generatedSha256) throw Error('Generated entry mismatch');
console.log(`Verified original archive and ${Object.keys(manifest.files).length} extracted files.`);
