import { encodeWire, decodeWire } from './wire.js';

// Installed by the separate entry before vendor modules execute.
function showFailure(message: string) {
  const render = () => {
    let panel = document.getElementById('webui-compatibility-error');
    if (!panel) { panel = document.createElement('pre'); panel.id = 'webui-compatibility-error';
      panel.style.cssText = 'position:fixed;inset:16px;z-index:2147483647;overflow:auto;padding:24px;background:Canvas;color:CanvasText;white-space:pre-wrap;font:14px system-ui';
      document.body.append(panel); }
    panel.textContent = `Codex WebUI compatibility error\n\n${message}`;
  };
  if (document.body) render(); else document.addEventListener('DOMContentLoaded', render, { once: true });
}
Object.defineProperty(window, 'electronBridge', { value: Object.freeze({
  async sendMessageFromView(message: { type?: string }) {
    if (message.type === 'electron-window-focus-request') {
      window.postMessage({ type: 'electron-window-focus-changed', isFocused: document.hasFocus() }, window.location.origin); return;
    }
    const response = await fetch('/bridge-message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(message) });
    const result = await response.json();
    if (!response.ok) { const error = result.error ?? 'Legacy bridge request failed'; showFailure(error); throw Error(error); }
    for (const event of result.events ?? []) window.postMessage(event, window.location.origin);
  }
}) });
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'connect-app-host') return;
  const port: MessagePort = event.data.port;
  if (!port) { showFailure('Renderer did not provide an app-host MessagePort'); return; }
  const url = new URL('/app-host', window.location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const pending: unknown[] = [];
  let opened = false;
  port.onmessage = event => {
    if (event.data === null) { socket.close(); return; }
    if (opened) socket.send(encodeWire(event.data)); else pending.push(event.data);
  };
  port.start();
  socket.onopen = () => { opened = true; for (const frame of pending.splice(0)) socket.send(encodeWire(frame)); };
  socket.onmessage = event => { try { port.postMessage(decodeWire(event.data)); } catch (error) { showFailure(String(error)); socket.close(); } };
  socket.onerror = () => showFailure('Cannot connect to the shared manager. Check the host diagnostics and upstream socket configuration.');
  socket.onclose = () => { port.postMessage(null); port.close(); showFailure('Shared-manager connection closed. Reload to reconnect; submitted mutations are never replayed.'); };
});
window.addEventListener('error', event => showFailure(event.message));
window.addEventListener('unhandledrejection', event => showFailure(String(event.reason)));
