import { RpcChannel } from './rpc-channel.js';

// The Electron router reads this metadata rather than the browser's pathname.
if (!document.querySelector('meta[name="initial-route"]') && !new URL(location.href).searchParams.has('initialRoute')) {
  const route = document.createElement('meta'); route.name = 'initial-route';
  // The packaged home route targets ChatGPT; reuse its existing Codex new-thread route.
  route.content = ['/', '/index.html', '/standalone.html'].includes(location.pathname) ? '/hotkey-window/new-thread' : location.pathname + location.search + location.hash;
  document.head.append(route);
}

class UnsupportedNativeIntegration extends Error {}
const unavailable = new Set<string>();
function reportUnavailable(message: string) {
  unavailable.add(message);
  const render = () => {
    let panel = document.getElementById('webui-unavailable-integrations');
    if (!panel) {
      panel = document.createElement('details'); panel.id = 'webui-unavailable-integrations';
      panel.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:2147483646;max-width:360px;max-height:30vh;overflow:auto;padding:8px;background:Canvas;color:CanvasText;font:12px system-ui';
      document.body.append(panel);
    }
    const summary = document.createElement('summary'); summary.textContent = 'Unavailable desktop integrations';
    const text = document.createElement('pre'); text.style.whiteSpace = 'pre-wrap'; text.textContent = [...unavailable].join('\n');
    panel.replaceChildren(summary, text);
  };
  if (document.body) render(); else document.addEventListener('DOMContentLoaded', render, { once: true });
}

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
    if (!response.ok) {
      const error = result.error ?? 'Legacy bridge request failed';
      if (response.status === 501) { reportUnavailable(error); throw new UnsupportedNativeIntegration(error); }
      showFailure(error); throw Error(error);
    }
    for (const event of result.events ?? []) window.postMessage(event, window.location.origin);
  }
}) });
window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== window.location.origin || event.data?.type !== 'connect-app-host') return;
  const port: MessagePort = event.data.port;
  if (!port) { showFailure('Renderer did not provide an app-host MessagePort'); return; }
  const url = new URL('/app-host', window.location.href); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const session = crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const n = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? n : (n & 3) | 8).toString(16);
  });
  let socket: WebSocket;
  let established = false, stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let outageStarted = 0;
  const status = (message?: string) => {
    let panel = document.getElementById('webui-connection-status');
    if (!message) { panel?.remove(); return; }
    if (!panel && document.body) { panel = document.createElement('div'); panel.id = 'webui-connection-status';
      panel.setAttribute('role', 'status'); panel.style.cssText = 'position:fixed;top:8px;right:8px;z-index:2147483646;padding:12px;background:Canvas;color:CanvasText;font:14px system-ui'; document.body.append(panel); }
    if (panel) panel.textContent = message;
  };
  const channel = new RpcChannel(frame => port.postMessage(frame));
  const stop = (error?: string) => {
    if (stopped) return;
    stopped = true; clearTimeout(retry); channel.disconnect(); socket?.close(); port.postMessage(null); port.close(); status();
    if (error) showFailure(error);
  };
  port.onmessage = event => {
    if (event.data === null) { stop(); return; }
    try { channel.send(event.data); } catch (error) { stop(String(error)); }
  };
  port.start();
  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(url);
    let ready = false;
    socket.onopen = () => socket.send(JSON.stringify({ session, resume: established }));
    socket.onmessage = event => {
      try {
        if (!ready) {
          if (JSON.parse(event.data).session !== session) throw Error('Invalid RPC session handshake');
          ready = true; established = true; outageStarted = 0; status();
          channel.connect(packet => socket.send(packet));
        } else {
          const message = JSON.parse(event.data);
          if (typeof message.webuiNavigate === 'string' && /^\/local\/[a-f0-9-]{36}$/i.test(message.webuiNavigate)) {
            location.assign(message.webuiNavigate); return;
          }
          channel.receive(event.data);
        }
      } catch (error) { stop(String(error)); }
    };
    socket.onerror = () => {}; // close handles connection failures and bounded retry.
    socket.onclose = event => {
      channel.disconnect();
      if (stopped) return;
      if (event.code === 4009 || event.code === 1003 || event.code === 1008) {
        stop('Shared-manager RPC session ended. Inspect the thread before reloading; uncertain mutations are never replayed.'); return;
      }
      outageStarted ||= Date.now();
      if (Date.now() - outageStarted > 25000) { stop('Cannot recover the shared-manager connection. Inspect the thread before reloading.'); return; }
      status('Reconnecting to the shared manager…'); retry = setTimeout(connect, 500);
    };
  };
  window.addEventListener('pagehide', () => stop(), { once: true });
  connect();
});
window.addEventListener('error', event => {
  // Browsers defer undelivered ResizeObserver notifications to the next frame.
  // This layout diagnostic is not an exception or a failed host connection.
  if (!event.error && ['ResizeObserver loop completed with undelivered notifications.', 'ResizeObserver loop limit exceeded'].includes(event.message)) return;
  showFailure(event.message);
});
window.addEventListener('unhandledrejection', event => {
  if (event.reason instanceof UnsupportedNativeIntegration) { event.preventDefault(); reportUnavailable(event.reason.message); return; }
  showFailure(String(event.reason));
});
void fetch('/manager-status').then(async response => {
  if (response.status === 404) return; // Test-only asset hosts can omit this endpoint.
  const status = await response.json();
  if (!response.ok) showFailure(status.error ?? 'Shared manager unavailable');
  else if (status.rendererCompatibility === 'requires-server-version') showFailure('Set CODEX_SERVER_VERSION to the existing server’s actual semantic version. The original renderer requires this metadata; initialize.userAgent is not a server-version field.');
}).catch(error => showFailure(`Cannot read host startup diagnostics: ${error.message}`));

// Legacy settings changes are shared across browser devices through the host.
const legacyEvents = new EventSource('/bridge-events');
legacyEvents.onmessage = event => {
  try { window.postMessage(JSON.parse(event.data), location.origin); }
  catch (error) { showFailure(`Invalid shared settings event: ${String(error)}`); }
};
window.addEventListener('pagehide', () => legacyEvents.close(), { once: true });
