import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';
import { loadVendorRuntime } from '../dist/src/vendor-runtime.js';

// Evidence inventory, not a claim that every optional desktop feature is supported.
const root = resolve('.generated/webview/assets');
const services = new Map<string, Set<string>>();
const messages = new Map<string, Set<string>>();
async function scan(directory: string) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) { await scan(path); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const source = await readFile(path, 'utf8');
    if (!source.includes('appServices') && !source.includes('dispatchMessage') && !source.includes('postMessage') && !source.includes('sendMessageFromView')) continue;
    for (const match of source.matchAll(/appServices\??\.([\w]+)(?:\??\.([\w]+))?/g)) {
      const key = match[1];
      if (!services.has(key)) services.set(key, new Set());
      services.get(key)!.add(`${relative(root, path)}: ${match[0]}`);
    }
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    simple(ast, { CallExpression(node: any) {
      let callee = node.callee;
      if (callee.type === 'SequenceExpression') callee = callee.expressions.at(-1);
      if (callee.type !== 'MemberExpression' || !['sendMessageFromView', 'postMessage', 'dispatchMessage'].includes(callee.property.name)) return;
      const dispatch = callee.property.name === 'dispatchMessage';
      const argument = node.arguments[dispatch ? 1 : 0];
      const property = argument?.properties?.find((p: any) => (p.key?.name ?? p.key?.value) === 'type');
      const key = (dispatch ? node.arguments[0]?.value : property?.value?.value) ?? '<dynamic>';
      if (!messages.has(key)) messages.set(key, new Set());
      messages.get(key)!.add(`${relative(root, path)}: ${source.slice(argument?.start ?? node.start, argument?.end ?? node.end)}`);
    } });
  }
}
await scan(root);
const vendor = await loadVendorRuntime('.generated');
const facade = vendor.manager.gR.toString();
const ast: any = parse(`(${facade})`, { ecmaVersion: 'latest' });
const methods = ast.body[0].expression.body.body.filter((m: any) => m.key.type === 'Identifier')
  .map((m: any) => ({ name: m.key.name, kind: m.kind, source: facade.slice(m.start - 1, m.end - 1) }));
const entries = (map: Map<string, Set<string>>) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, [...values].sort()]));
await writeFile('docs/renderer-inventory.json', JSON.stringify({
  archiveSha256: vendor.manifest.archiveSha256,
  scope: 'Static direct references across generated renderer assets; postMessage entries include candidates on non-Electron transports. Aliases and dynamic arguments require manual tracing. Method bodies preserve exact pinned argument and return semantics.',
  services: entries(services), electronBridgeMessages: entries(messages), managerFacade: methods
}, null, 2) + '\n');
