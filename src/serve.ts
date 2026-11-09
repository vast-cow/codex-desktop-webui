import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { homedir } from 'node:os';
import { WebSocketServer } from 'ws';
import { createAssetHost } from './asset-host.js';
import { SharedManager } from './shared-manager.js';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('PORT must be between 0 and 65535');
const host = process.env.HOST ?? '0.0.0.0';
const server = await createAssetHost(resolve('.generated'));
let manager: SharedManager | undefined;
let stopping = false;
let reconnecting = false;
const legacyEvents = new EventEmitter();
legacyEvents.setMaxListeners(0);
let startupError = 'CODEX_SOCKET_PATH or CODEX_SERVER_URL is required to connect the shared manager';
async function connectManager() {
  if (stopping || reconnecting) return;
  reconnecting = true;
  try {
    await manager?.close();
    manager = undefined;
    manager = await SharedManager.start(resolve('.generated'), resolve(process.env.WEBUI_DATA_DIR ?? resolve(homedir(), '.local/share/standalone-codex-webui')), {
    socketPath: process.env.CODEX_SOCKET_PATH || undefined, serverUrl: process.env.CODEX_SERVER_URL || undefined, upgradePath: process.env.CODEX_UPGRADE_PATH, serverVersion: process.env.CODEX_SERVER_VERSION
  }, resolve(process.env.CODEX_WORKSPACE_ROOT ?? process.cwd()));
    manager.worker.on('message', message => { if (message.type === 'legacy-event') legacyEvents.emit('event', message.event); });
  } catch (error: any) { startupError = error.message; console.error('Shared manager startup failed:', startupError); }
  finally {
    reconnecting = false;
    if (stopping) await manager?.close();
  }
}
const configured = !!(process.env.CODEX_SOCKET_PATH || process.env.CODEX_SERVER_URL);
if (configured) await connectManager();
// A new worker discards stale manager caches and pending mutations. Never replay them.
const recovery = setInterval(() => { if (configured && !manager?.available) void connectManager(); }, 3000);
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/app-host' || !manager?.available) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
  wss.handleUpgrade(request, socket, head, client => manager!.attach(client));
});
// Reserve the legacy endpoint before the static asset listener handles requests.
const assetListeners = server.listeners('request'); server.removeAllListeners('request');
server.on('request', async (request, response) => {
  if (request.url === '/bridge-events' && request.method === 'GET') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    response.write(': connected\n\n');
    let initialized = false;
    const queued: unknown[] = [];
    const send = (event: unknown) => {
      if (!response.write(`data: ${JSON.stringify(event)}\n\n`)) response.destroy();
    };
    const publish = (event: unknown) => {
      if (initialized) send(event);
      else if (queued.length < 1024) queued.push(event);
      else response.destroy();
    };
    legacyEvents.on('event', publish);
    const heartbeat = setInterval(() => { if (!response.write(': heartbeat\n\n')) response.destroy(); }, 15000);
    response.on('close', () => { clearInterval(heartbeat); legacyEvents.off('event', publish); });
    try {
      const snapshot = await manager?.hostRequest({ type: 'persisted-atom-sync-request' });
      if (!response.destroyed) {
        for (const event of snapshot?.events ?? []) send(event);
        initialized = true;
        for (const event of queued) send(event);
      }
    } catch { response.destroy(); }
    return;
  }
  if (request.url === '/bridge-message' && request.method === 'POST') {
    try {
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 1024 * 1024) { response.writeHead(413); response.end(); return; } }
      const message = JSON.parse(body);
      if (message.type === 'log-message') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"events":[]}'); return; }
      if (manager?.available && ['request-app-server-state', 'persisted-atom-sync-request', 'persisted-atom-update'].includes(message.type)) {
        const result = await manager.hostRequest(message); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return;
      }
      response.writeHead(501, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: `Unsupported native message: ${message.type}` }));
    } catch (error: any) {
      if (response.destroyed) return;
      response.writeHead(error instanceof SyntaxError ? 400 : 501, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof SyntaxError ? 'Invalid bridge message' : error.message }));
    }
    return;
  }
  if (request.url === '/manager-status' || request.url === '/healthz') {
    response.writeHead(manager?.available ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ state: manager?.available ? 'ready' : 'unavailable', error: manager?.available ? undefined : manager?.error ?? startupError,
      verificationEvents: manager?.verificationEvents,
      accountStatus: manager?.available ? manager.accountStatus : 'connection-unavailable',
      rendererServices: manager?.available ? 'limited' : 'unavailable',
      rendererCompatibility: process.env.CODEX_SERVER_VERSION ? 'requires-live-verification' : 'requires-server-version', proofGate: 'not-passed' })); return;
  }
  for (const listener of assetListeners) listener.call(server, request, response);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Feasibility host listening on ${host}:${(server.address() as any).port}; manager ${manager ? 'ready' : startupError}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  stopping = true; clearInterval(recovery);
  legacyEvents.removeAllListeners();
  for (const client of wss.clients) client.terminate(); wss.close(); server.close(); server.closeAllConnections(); await manager?.close();
});
