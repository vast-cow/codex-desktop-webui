import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { WebSocketServer } from 'ws';
import { createAssetHost } from './asset-host.js';
import { SharedManager } from './shared-manager.js';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be between 1 and 65535');
const host = process.env.HOST ?? '0.0.0.0';
const server = await createAssetHost(resolve('.generated'));
let manager: SharedManager | undefined;
let startupError = 'CODEX_SOCKET_PATH is required to connect the shared manager';
if (process.env.CODEX_SOCKET_PATH) {
  try { manager = await SharedManager.start(resolve('.generated'), resolve(process.env.WEBUI_DATA_DIR ?? resolve(homedir(), '.local/share/standalone-codex-webui')), {
    socketPath: process.env.CODEX_SOCKET_PATH, upgradePath: process.env.CODEX_UPGRADE_PATH ?? '/rpc'
  }); } catch (error: any) { startupError = error.message; console.error('Shared manager startup failed:', startupError); }
}
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 });
server.on('upgrade', (request, socket, head) => {
  if (request.url !== '/app-host' || !manager?.available) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
  wss.handleUpgrade(request, socket, head, client => manager!.attach(client));
});
// Reserve the legacy endpoint before the static asset listener handles requests.
const assetListeners = server.listeners('request'); server.removeAllListeners('request');
server.on('request', async (request, response) => {
  if (request.url === '/bridge-message' && request.method === 'POST') {
    let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 1024 * 1024) { response.writeHead(413); response.end(); return; } }
    try {
      const message = JSON.parse(body);
      if (message.type === 'log-message') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end('{"events":[]}'); return; }
      if (manager && ['persisted-atom-sync-request', 'persisted-atom-update'].includes(message.type)) {
        const result = await manager.hostRequest(message); response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); return;
      }
      response.writeHead(501, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: `Unsupported native message: ${message.type}` }));
    } catch { response.writeHead(400); response.end('{"error":"Invalid bridge message"}'); }
    return;
  }
  if (request.url === '/manager-status') { response.writeHead(manager?.available ? 200 : 503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ state: manager?.available ? 'ready' : 'unavailable', error: manager?.available ? undefined : manager?.error ?? startupError, proofGate: 'not-passed' })); return; }
  for (const listener of assetListeners) listener.call(server, request, response);
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Feasibility host listening on ${host}:${port}; manager ${manager ? 'ready' : startupError}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => {
  for (const client of wss.clients) client.terminate(); wss.close(); server.close(); await manager?.close();
});
