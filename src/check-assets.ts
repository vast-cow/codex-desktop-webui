import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hashFile } from './asar.js';
const manifest = JSON.parse(await readFile('.generated/manifest.json', 'utf8'));
const archive = resolve(process.argv[2] ?? 'chatgpt/usr/lib/chatgpt/resources/app.asar');
if (await hashFile(archive) !== manifest.archiveSha256) throw Error('Original archive hash mismatch');
for (const [path, hash] of Object.entries(manifest.files)) {
  if (await hashFile(resolve('.generated', path)) !== hash) throw Error(`Extracted asset mismatch: ${path}`);
}
if (await hashFile('.generated/standalone.html') !== manifest.entry.generatedSha256) throw Error('Generated entry mismatch');
console.log(`Verified original archive and ${Object.keys(manifest.files).length} extracted files.`);
