import { Worker, MessageChannel } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type WebSocket from 'ws';
import type { UpstreamOptions } from './upstream.js';
import { encodeWire, decodeWire } from './wire.js';

/** A worker belongs to the HTTP host, never to an individual browser. */
export class SharedManager {
  available = true;
  accountStatus = 'acquiring';
  verificationEvents: Record<string, number> = {};
  error?: string;
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
    worker.on('exit', code => { manager.available = false; manager.error ??= `Manager worker exited (${code})`; });
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
    if (!this.available) { socket.close(1013, this.error?.slice(0, 100) ?? 'Manager unavailable'); return; }
    const id = randomUUID(), { port1, port2 } = new MessageChannel();
    let closed = false;
    const close = () => { if (closed) return; closed = true; this.worker.postMessage({ type: 'detach', id }); port1.close(); socket.close(); };
    port1.on('message', frame => {
      if (frame === null) { close(); return; }
      if (socket.bufferedAmount > 8 * 1024 * 1024) { socket.close(1013, 'Client cannot keep up; reconnect'); close(); return; }
      try { socket.send(encodeWire(frame)); } catch (error) { console.error('Browser RPC encoding failed:', error); close(); }
    });
    socket.on('message', (data, binary) => {
      try { if (binary) throw Error('Binary browser frames unsupported'); port1.postMessage(decodeWire(data.toString())); }
      catch (error) { console.error('Browser RPC decoding failed:', error); socket.close(1003, 'Invalid RPC frame'); close(); }
    });
    socket.on('close', close); socket.on('error', close);
    this.worker.postMessage({ type: 'attach', id, port: port2 }, [port2]);
  }
  async close() {
    this.worker.postMessage({ type: 'shutdown' });
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { void this.worker.terminate().then(() => resolve()); }, 5000);
      this.worker.once('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}
