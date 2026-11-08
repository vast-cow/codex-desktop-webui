import vm from 'node:vm';
import { createDisposableStack } from './disposable-stack.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeHTMLStrict } from 'entities';
import { sha256 } from './asar.js';
import { factories, ModuleLoader, type Factory } from './loader.js';

/** Load only hash-pinned inert factories; never evaluate a chunk entry point. */
export async function loadVendorRuntime(root: string) {
  const pin = JSON.parse(await readFile(resolve('compatibility/vendor.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  if (manifest.archiveSha256 !== pin.archiveSha256) throw Error('Unsupported vendor archive');
  const table = new Map<string, Factory>();
  const paths = Object.keys(pin.chunks).sort((a, b) => Number(!a.startsWith('async/182735.')) - Number(!b.startsWith('async/182735.')) || a.localeCompare(b));
  for (const path of paths) {
    const source = await readFile(resolve(root, 'webview/assets', path), 'utf8');
    if (sha256(source) !== pin.chunks[path]) throw Error(`Chunk hash mismatch: ${path}`);
    for (const factory of factories(source, path)) if (!table.has(factory.id)) table.set(factory.id, factory);
  }
  const original = table.get('cxUs');
  const replacement = 'function(e,t,n){n.d(t,{},{s:globalThis.decodeNamedEntity})}';
  if (!original || sha256(original.source) !== pin.candidate.expectedFactorySha256 || sha256(replacement) !== pin.candidate.replacementFactorySha256) throw Error('Candidate factory hash mismatch');
  table.set('cxUs', { ...original, source: replacement });
  const loader = new ModuleLoader(table, { decodeNamedEntity: (name: string) => {
    const input = `&${name};`, output = decodeHTMLStrict(input);
    return (output.charCodeAt(output.length - 1) !== 59 || name === 'semi') && output !== input && output;
  } });
  const manager = loader.require('V7mA'), rpc = loader.require('Fkn8');
  loader.context.DisposableStack = vm.runInContext(`(${createDisposableStack.toString()})()`, loader.context);
  return { loader, manager, rpc, manifest };
}
