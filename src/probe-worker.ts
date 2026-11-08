import { managerContract } from './manager-contract.js';
import { decodeHTMLStrict } from 'entities';
import { sha256 } from './asar.js';
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { factories, ModuleLoader, type Factory } from './loader.js';

const root = resolve(workerData.root, 'webview/assets');
const manifest = JSON.parse(await readFile(resolve(workerData.root, 'manifest.json'), 'utf8'));
const compatibility = JSON.parse(await readFile('compatibility/vendor.json', 'utf8'));
if (compatibility.archiveSha256 !== manifest.archiveSha256) throw Error('Unsupported archive: review compatibility manifest before probing');
const paths = Object.keys(compatibility.chunks).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
function rank(path: string) { return path.startsWith('async/182735.') ? 0 : !path.includes('/') ? 1 : 2; }
const table = new Map<string, Factory>();
const chunks: string[] = [];
for (const path of paths) {
  const source = await readFile(resolve(root, path), 'utf8');
  if (sha256(source) !== compatibility.chunks[path]) throw Error(`Chunk hash mismatch: ${path}`);
  for (const factory of factories(source, path)) if (!table.has(factory.id)) table.set(factory.id, factory);
  chunks.push(path);
}
const closure = new Set<string>();
function visit(id: string) {
  if (closure.has(id)) return;
  closure.add(id);
  for (const dependency of table.get(id)?.dependencies ?? []) visit(dependency);
}
visit('V7mA'); visit('Fkn8');
const outcomes = [];
for (const id of ['Fkn8', 'V7mA']) {
  const loader = new ModuleLoader(table);
  try {
    const exports = loader.require(id);
    outcomes.push({ id, status: 'loaded', exports: Object.keys(exports), managerType: id === 'V7mA' ? typeof exports.O3 : undefined, loaded: loader.loaded });
  } catch (error: any) {
    outcomes.push({ id, status: 'blocked', message: error.message, stack: error.stack, loaded: loader.loaded });
  }
}
// A narrowly scoped experiment measures whether HTML entity decoding is the only DOM dependency.
const candidateTable = new Map(table);
const original = table.get('cxUs')!;
const replacement = 'function(e,t,n){n.d(t,{},{s:globalThis.decodeNamedEntity})}';
if (sha256(original.source) !== compatibility.candidate.expectedFactorySha256 || sha256(replacement) !== compatibility.candidate.replacementFactorySha256) throw Error('Candidate factory hash mismatch');
candidateTable.set('cxUs', { ...original, source: replacement });
const candidateLoader = new ModuleLoader(candidateTable, { decodeNamedEntity: (name: string) => {
  const input = `&${name};`, output = decodeHTMLStrict(input);
  return (output.charCodeAt(output.length - 1) !== 59 || name === 'semi') && output !== input && output;
} });
let candidateOutcome;
try { const exports = candidateLoader.require('V7mA'); candidateOutcome = { status: 'loaded', managerType: typeof exports.O3 }; }
catch (error: any) { candidateOutcome = { status: 'blocked', message: error.message, stack: error.stack, loaded: candidateLoader.loaded }; }
parentPort!.postMessage({ managerContract: managerContract(table.get('V7mA')!.source), candidate: { id: 'cxUs', purpose: 'Replace DOM-backed named HTML entity decoder in worker only',
  chunk: original.chunk, expectedFactorySha256: sha256(original.source), replacementFactorySha256: sha256(replacement), outcome: candidateOutcome }, indexedModules: table.size, chunks: chunks.length,
  closure: [...closure].sort().map(id => ({ id, ...table.get(id), source: undefined })), outcomes });
