import { Worker, MessageChannel } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type WebSocket from 'ws';
import type { UpstreamOptions } from './upstream.js';
import { RpcChannel } from './rpc-channel.js';

/** A worker belongs to the HTTP host, never to an individual browser. */
export class SharedManager {
  available = true;
  accountStatus = 'acquiring';
  verificationEvents: Record<string, number> = {};
  error?: string;
  private sessions = new Map<string, { channel: RpcChannel; socket?: WebSocket; timer?: NodeJS.Timeout; close(): void }>();
  private exited = false;
  private closing?: Promise<void>;
  private requests = new Map<string, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>();
  private constructor(readonly worker: Worker) {}
  static async start(root: string, dataDirectory: string, upstream: UpstreamOptions, workspaceRoot = process.cwd()) {
    const worker = new Worker(resolve('dist/src/manager-worker.js'), { workerData: { root, dataDirectory, upstream, workspaceRoot }, execArgv: [] });
    const manager = new SharedManager(worker);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => finish(Error('Manager startup timed out')), 60000);
        const message = (event: any) => { if (event.type === 'ready') { manager.verificationEvents = event.counts; manager.accountStatus = event.accountStatus; finish(); } };
        const exited = (code: number) => finish(Error(`Manager worker exited during startup (${code})`));
        const finish = (error?: Error) => { clearTimeout(timer); worker.off('error', finish); worker.off('message', message); worker.off('exit', exited); if (error) reject(error); else resolve(); };
        worker.on('error', finish); worker.on('message', message); worker.on('exit', exited);
      });
    } catch (error) { await worker.terminate(); throw error; }
    worker.on('message', message => {
      if (message.type === 'verification-event') { manager.verificationEvents = message.counts; }
      else if (message.type === 'account-status') { manager.accountStatus = message.status; }
      else if (message.type === 'host-response') {
        const pending = manager.requests.get(message.id);
        if (pending) { clearTimeout(pending.timer); manager.requests.delete(message.id); if (message.error) pending.reject(Error(message.error)); else pending.resolve(message.result); }
      } else if (message.error) {
        if (message.type === 'disconnected') { manager.available = false; manager.error = message.error; }
        console.error(`Manager ${message.type}: ${message.error}`);
      }
    });
    worker.on('error', error => { manager.available = false; manager.error = error.message; console.error('Manager worker failed:', error.message); });
    worker.on('exit', code => { manager.exited = true; manager.available = false; manager.error ??= `Manager worker exited (${code})`; });
    return manager;
  }
  hostRequest(message: unknown): Promise<any> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(id); reject(Error('Host request timed out')); }, 15000);
      this.requests.set(id, { resolve, reject, timer }); this.worker.postMessage({ type: 'host-request', id, message });
    });
  }
  attach(socket: WebSocket) {
    if (!this.available) { socket.close(1013, 'Manager unavailable'); return; }
    const handshakeTimer = setTimeout(() => socket.close(1008, 'Session handshake timed out'), 5000);
    socket.once('close', () => clearTimeout(handshakeTimer));
    socket.once('error', () => {});
    socket.once('message', (data, binary) => {
      clearTimeout(handshakeTimer);
      try {
        const hello = JSON.parse(data.toString());
        if (binary || typeof hello.session !== 'string' || !/^[a-f0-9-]{36}$/.test(hello.session) || typeof hello.resume !== 'boolean') throw Error('Invalid session handshake');
        let session = this.sessions.get(hello.session);
        if (!session && hello.resume) { socket.close(4009, 'RPC session expired; inspect thread before reconnecting'); return; }
        if (session?.socket) {
          if (!hello.resume) { socket.close(1008, 'RPC session already connected'); return; }
          // A network partition may leave the previous TCP connection half open.
          const previous = session.socket; session.socket = undefined;
          session.channel.disconnect(); previous.close(4009, 'RPC transport replaced');
        }
        if (!session) {
          const id = randomUUID(), { port1, port2 } = new MessageChannel();
          const channel = new RpcChannel(frame => port1.postMessage(frame));
          const close = () => {
            const current = this.sessions.get(hello.session);
            if (!current) return;
            this.sessions.delete(hello.session); clearTimeout(current.timer);
            current.channel.disconnect(); current.socket?.close(4009, 'RPC session ended');
            this.worker.postMessage({ type: 'detach', id }); port1.close();
          };
          session = { channel, close };
          this.sessions.set(hello.session, session);
          port1.on('message', frame => {
            if (typeof frame?.webuiNavigate === 'string') {
              const socket = session?.socket;
              if (socket?.readyState === 1) socket.send(JSON.stringify({ webuiNavigate: frame.webuiNavigate }));
              return;
            }
            if (frame === null) { close(); return; }
            try { channel.send(frame); } catch { close(); }
          });
          this.worker.postMessage({ type: 'attach', id, port: port2 }, [port2]);
        }
        const current = session;
        clearTimeout(current.timer); current.socket = socket;
        const suspend = () => {
          if (current.socket !== socket) return;
          current.socket = undefined; current.channel.disconnect();
          current.timer = setTimeout(current.close, 30000); current.timer.unref();
        };
        socket.on('close', suspend); socket.on('error', suspend);
        socket.on('message', (packet, binary) => {
          if (current.socket !== socket) return;
          try { if (binary) throw Error('Binary RPC frame'); current.channel.receive(packet.toString()); }
          catch { current.close(); }
        });
        socket.send(JSON.stringify({ session: hello.session }));
        current.channel.connect(packet => {
          if (socket.bufferedAmount > 8 * 1024 * 1024) { socket.close(1013, 'Client cannot keep up'); return; }
          socket.send(packet);
        });
      } catch { socket.close(1003, 'Invalid session handshake'); }
    });
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.available = false;
    for (const session of this.sessions.values()) session.close();
    for (const pending of this.requests.values()) { clearTimeout(pending.timer); pending.reject(Error('Manager closed')); }
    this.requests.clear();
    if (this.exited) return Promise.resolve();
    this.worker.postMessage({ type: 'shutdown' });
    return this.closing = new Promise<void>(resolve => {
      const timer = setTimeout(() => { void this.worker.terminate().then(() => resolve()); }, 5000);
      this.worker.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
