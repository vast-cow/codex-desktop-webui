import vm from 'node:vm';
import { parse } from 'acorn';
import { simple } from 'acorn-walk';

export interface Factory { id: string; source: string; chunk: string; start: number; end: number; dependencies: string[] }
export function factories(source: string, chunk: string): Factory[] {
  const result: Factory[] = [];
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  simple(ast, { VariableDeclarator(node: any) {
    // Rspack ESM chunks export inert factory tables. Runtime/entry chunks are excluded.
    if (node.id.name !== '__webpack_modules__' || node.init?.type !== 'ObjectExpression') return;
    for (const property of node.init.properties) {
      const value = property.value;
      if (property.type !== 'Property' || value.type !== 'FunctionExpression') throw Error(`Unexpected factory in ${chunk}`);
      const id = property.key.name ?? property.key.value;
      const requireName = value.params[2]?.name;
      const dependencies = new Set<string>();
      simple(value.body, { CallExpression(call: any) {
        if (requireName && call.callee.type === 'Identifier' && call.callee.name === requireName && typeof call.arguments[0]?.value === 'string') dependencies.add(call.arguments[0].value);
      }});
      result.push({ id, source: property.method ? `function${source.slice(value.start, value.end)}` : source.slice(value.start, value.end),
        chunk, start: property.start, end: property.end, dependencies: [...dependencies].sort() });
    }
  }});
  return result;
}
export class ModuleLoader {
  readonly loaded: string[] = [];
  readonly stack: string[] = [];
  readonly context: vm.Context;
  private cache = new Map<string, { exports: any }>();
  constructor(private table: Map<string, Factory>, adapters: Record<string, unknown> = {}) {
    // This is an isolation boundary for startup, not a security sandbox for untrusted code.
    this.context = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval,
      queueMicrotask, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, AbortSignal,
      ReadableStream, WritableStream, TransformStream, Headers, Request, Response, Blob,
      performance, crypto: globalThis.crypto, ...adapters });
  }
  require = Object.assign((id: string): any => {
    if (this.cache.has(id)) return this.cache.get(id)!.exports;
    const factory = this.table.get(id);
    if (!factory) throw Error(`Missing bundled module ${id}; chain: ${[...this.stack, id].join(' -> ')}`);
    const module = { exports: {} };
    this.cache.set(id, module);
    this.stack.push(id);
    this.loaded.push(id);
    try {
      const fn = vm.runInContext(`(${factory.source})`, this.context, { filename: `${factory.chunk}#${id}`, timeout: 5000 });
      // Run invocation with a timeout too, not just factory compilation.
      this.context.__factory = fn; this.context.__module = module; this.context.__require = this.require;
      vm.runInContext('__factory(__module, __module.exports, __require)', this.context, { timeout: 5000 });
      return module.exports;
    } catch (error) {
      this.cache.delete(id);
      throw error;
    } finally { this.stack.pop(); }
  }, {
    d: (target: any, getters: any, values?: any) => {
      for (const [key, get] of Object.entries(getters)) if (!Object.hasOwn(target, key)) Object.defineProperty(target, key, { enumerable: true, get: get as () => any });
      for (const [key, value] of Object.entries(values ?? {})) if (!Object.hasOwn(target, key)) Object.defineProperty(target, key, { enumerable: true, value });
    },
    n: (value: any) => { const get = value?.__esModule ? () => value.default : () => value; Object.defineProperty(get, 'a', { get }); return get; },
    o: (object: any, key: string) => Object.hasOwn(object, key),
    r: (exports: any) => { Object.defineProperty(exports, '__esModule', { value: true }); Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' }); },
    nmd: (module: any) => { module.paths = []; module.children ??= []; return module; },
    g: undefined,
    j: 348410, p: '/',
    e: (id: unknown) => Promise.reject(Error(`Dynamic chunk ${id} requires an explicit adapter`))
  });
}
