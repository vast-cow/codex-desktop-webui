import { parentPort, workerData, type MessagePort } from 'node:worker_threads';
import vm from 'node:vm';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { loadVendorRuntime } from './vendor-runtime.js';
import { managerAdapters } from './manager-adapters.js';
import { HostState } from './host-state.js';
import { Upstream } from './upstream.js';
import { CodexAccount } from './codex-account.js';
import { rendererServices } from './renderer-services.js';

const { root, dataDirectory, upstream: upstreamOptions } = workerData;
const workspaceRoot = resolve(workerData.workspaceRoot);
if (!(await stat(workspaceRoot)).isDirectory()) throw Error('Configured workspace root is not a directory');
const vendor = await loadVendorRuntime(root);
const state = await HostState.open(dataDirectory);
const upstream = new Upstream(upstreamOptions);
upstream.on('verification-event', counts => parentPort!.postMessage({ type: 'verification-event', counts }));
// Cross-realm records must be ordinary objects in the vendor VM, including RPC results.
const clone = vm.runInContext(`(function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Array.from(value, clone);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
})`, vendor.loader.context);
const vmError = vm.runInContext('(message) => new Error(message)', vendor.loader.context);
const adapters = managerAdapters(state, upstream, dataDirectory, clone);
const sendRequest = adapters.options.transport.sendRequest;
adapters.options.transport.sendRequest = async (...args) => {
  try { return clone(await sendRequest(...args)); }
  catch (error: any) { throw vmError(error.message); }
};
const manager = new vendor.manager.O3(adapters.options);
const codexAccount = new CodexAccount(upstream);
codexAccount.subscribe(snapshot => parentPort!.postMessage({ type: 'account-status', status: snapshot.status, revision: snapshot.revision }));
const sessions = new Map<string, { port: MessagePort; dispose(): void }>();
const factory = vm.runInContext(`(${rendererServices.toString()})`, vendor.loader.context);
upstream.on('notification', frame => { if (frame.method === 'account/updated' || frame.method === 'account/login/completed') void codexAccount.refresh(); try { manager.onNotification(frame.method, clone(frame.params)); } catch (error: any) { parentPort!.postMessage({ type: 'diagnostic', error: error.message }); } });
upstream.on('request', frame => { try { manager.onRequest(clone(frame)); } catch (error: any) { parentPort!.postMessage({ type: 'diagnostic', error: error.message }); } });
upstream.on('disconnected', error => {
  codexAccount.disconnect();
  for (const session of sessions.values()) { session.port.postMessage(null); session.dispose(); session.port.close(); }
  sessions.clear(); parentPort!.postMessage({ type: 'disconnected', error: error.message });
});
await upstream.connect();
void codexAccount.refresh();
parentPort!.postMessage({ type: 'ready', counts: upstream.verificationEvents, hostId: manager.getHostId(), accountStatus: codexAccount.read().status });
parentPort!.on('message', async message => {
  try {
    if (message.type === 'host-request') {
      try {
        const request = message.message;
        let events: unknown[];
        if (request.type === 'request-app-server-state') events = [
          { type: 'codex-app-server-connection-changed', hostId: upstream.hostId, state: upstream.isReady ? 'connected' : 'disconnected' },
          ...(upstream.isReady ? [{ type: 'codex-app-server-initialized', hostId: upstream.hostId, appServerVersion: upstream.getSemanticVersion() ?? null }] : [])
        ];
        else if (request.type === 'persisted-atom-sync-request') events = [{ type: 'persisted-atom-sync', state: state.readValue('persisted-atoms') ?? {}, canWritePrimaryWindowTabPersistence: true }];
        else if (request.type === 'persisted-atom-update') {
          await state.updateGlobalState('persisted-atoms', value => { const next = { ...value }; if (request.recordUpdate != null) {
            const base = next[request.key] ?? next[request.recordUpdate.legacyStorageKey];
            Object.defineProperty(next, request.key, { value: vendor.loader.require('waIq').m(clone(base), clone(request.recordUpdate)), enumerable: true, configurable: true, writable: true });
          } else if (request.deleted) delete next[request.key]; else Object.defineProperty(next, request.key, { value: request.value, enumerable: true, configurable: true, writable: true }); return next; });
          const event = { type: 'persisted-atom-updated', key: request.key, value: (state.readValue('persisted-atoms') as any)?.[request.key], deleted: request.deleted };
          parentPort!.postMessage({ type: 'legacy-event', event });
          events = []; // Published once to all browsers, including the writer.
        } else throw Error(`Unsupported native message: ${request.type}`);
        parentPort!.postMessage({ type: 'host-response', id: message.id, result: { events } });
      } catch (error: any) { parentPort!.postMessage({ type: 'host-response', id: message.id, error: error.message }); }
    } else if (message.type === 'attach') {
      const services = factory({ RpcTarget: vendor.rpc.TF, ManagerFacade: vendor.manager.gR, manager,
        codexAccount: { read: () => clone(codexAccount.read()), subscribe: (callback: any) => codexAccount.subscribe(snapshot => callback(clone(snapshot))) },
        appInfo: clone({ version: vendor.manifest.applicationVersion, name: 'Standalone Codex WebUI', platform: process.platform, arch: process.arch }),
        host: async (method: string, key: string, value: unknown) => {
          if (method === 'workspaceRoots') return clone({ roots: [workspaceRoot], labels: {} });
          if (method === 'homePaths') return clone({ codexHome: resolve(homedir(), '.codex'), workspacesRoot: resolve(dataDirectory, 'workspaces') });
          if (method === 'homeDirectory') return homedir();
          if (method === 'read') return clone(state.readValue(key));
          if (method === 'write') { await state.writeValue(key, value); return; }
          throw Error(`Unsupported state method: ${method}`);
        } });
      // Node's MessagePort delivers Node-realm arrays. Cap'n Web checks VM
      // prototypes while parsing instructions, so normalize frames on ingress.
      const port = message.port as MessagePort;
      vendor.rpc.ab({ start: () => port.start(), close: () => port.close(),
        postMessage: (frame: unknown) => port.postMessage(frame),
        addEventListener: (type: string, listener: (event: any) => void) => {
          if (type === 'message') port.on('message', data => listener({ data: clone(data) }));
          else if (type === 'messageerror') port.on('messageerror', error => listener(error));
        }
      }, services.root);
      sessions.set(message.id, { port: message.port, dispose: services.dispose });
    } else if (message.type === 'detach') {
      const session = sessions.get(message.id);
      if (session) { session.port.postMessage(null); session.dispose(); session.port.close(); sessions.delete(message.id); }
    } else if (message.type === 'shutdown') {
      for (const session of sessions.values()) { session.port.postMessage(null); session.dispose(); session.port.close(); }
      sessions.clear(); upstream.close(); vendor.manager.O3.dispose(manager); await adapters.dispose();
      parentPort!.postMessage({ type: 'stopped' }); parentPort!.close();
    }
  } catch (error: any) { parentPort!.postMessage({ type: 'diagnostic', error: error.message }); }
});
