import { createConnection } from 'node:net';
import { EventEmitter } from 'node:events';
import { isAbsolute } from 'node:path';
import WebSocket from 'ws';

export type RpcId = string | number;
export interface UpstreamOptions { socketPath: string; upgradePath?: string; timeoutMs?: number }
export class DeliveryError extends Error {
  constructor(message: string, readonly outcome: 'not-sent' | 'unknown') { super(message); }
}
interface Pending { method: string; resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }

/** One host-owned connection. Browser leases never own or close this transport. */
export class Upstream extends EventEmitter {
  readonly hostId = 'local';
  private socket?: WebSocket;
  private pending = new Map<RpcId, Pending>();
  private serial = 0;
  private ready = false;
  private opening?: Promise<unknown>;
  private serverInfo: unknown;
  private approvals = new Set<RpcId>();
  private readonly timeoutMs: number;
  private readonly path: string;
  constructor(private options: UpstreamOptions) {
    super();
    if (!options.socketPath || !isAbsolute(options.socketPath)) throw Error('An explicit absolute upstream Unix socket path is required');
    this.path = options.upgradePath ?? '/rpc';
    if (!/^\/(?!\/)[^#\s]*$/.test(this.path)) throw Error('Invalid upstream upgrade path');
    this.timeoutMs = options.timeoutMs ?? 15000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw Error('Invalid upstream timeout');
  }
  getAppServerVersion() { return this.serverInfo; }
  getPendingRequestCount({ method }: { method?: string } = {}) { return [...this.pending.values()].filter(p => !method || p.method === method).length; }
  get isReady() { return this.ready; }
  connect(): Promise<unknown> {
    if (this.ready) return Promise.resolve(this.serverInfo);
    if (this.opening) return this.opening;
    this.opening = this.open().finally(() => { this.opening = undefined; });
    return this.opening;
  }
  private async open() {
    const socket = new WebSocket(`ws://localhost${this.path}`, {
      createConnection: () => createConnection({ path: this.options.socketPath }),
      handshakeTimeout: this.timeoutMs, maxPayload: 16 * 1024 * 1024,
    });
    this.socket = socket;
    socket.on('message', (data, binary) => {
      try {
        if (binary) throw Error('Binary upstream frames are unsupported');
        this.receive(JSON.parse(data.toString()));
      } catch (error) { this.fail(socket, error instanceof Error ? error : Error(String(error))); }
    });
    socket.on('error', error => this.fail(socket, error));
    socket.on('close', () => this.fail(socket, Error('Upstream disconnected')));
    try {
      await new Promise<void>((resolve, reject) => {
        const onOpen = () => { socket.off('error', onError); socket.off('close', onClose); resolve(); };
        const onError = (error: Error) => { cleanup(); reject(error); };
        const onClose = () => { cleanup(); reject(Error('Upstream closed before handshake')); };
        const cleanup = () => { socket.off('open', onOpen); socket.off('error', onError); socket.off('close', onClose); };
        socket.once('open', onOpen); socket.once('error', onError); socket.once('close', onClose);
      });
      const info = await this.dispatch('initialize', { clientInfo: { name: 'standalone-codex-webui', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      if (!info || typeof info !== 'object' || typeof (info as any).userAgent !== 'string') throw Error('Incompatible initialize response: expected userAgent');
      this.notify('initialized');
      this.serverInfo = info;
      this.ready = true;
      this.emit('ready', info);
      return info;
    } catch (error) { this.fail(socket, error instanceof Error ? error : Error(String(error))); throw error; }
  }
  sendRequest(method: string, params?: unknown): Promise<any> {
    if (!this.ready) return Promise.reject(new DeliveryError('Upstream is not initialized', 'not-sent'));
    return this.dispatch(method, params);
  }
  private dispatch(method: string, params?: unknown): Promise<any> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new DeliveryError('Upstream is disconnected', 'not-sent'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DeliveryError(`Upstream request timed out: ${method}`, 'unknown'));
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        socket.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }), error => {
          if (error) this.fail(socket, error);
        });
      } catch (error) { this.fail(socket, error instanceof Error ? error : Error(String(error))); }
    });
  }
  private notify(method: string) { this.socket!.send(JSON.stringify({ method })); }
  private receive(frame: any) {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw Error('Invalid upstream RPC envelope');
    if ('id' in frame && typeof frame.id !== 'string' && typeof frame.id !== 'number') throw Error('Invalid upstream RPC id');
    if (typeof frame.method === 'string') {
      if ('id' in frame) {
        if (this.approvals.has(frame.id)) throw Error('Duplicate pending upstream request id');
        this.approvals.add(frame.id);
        this.emit('request', frame);
      } else this.emit('notification', frame);
      return;
    }
    if (!('id' in frame) || (('result' in frame) === ('error' in frame))) throw Error('Invalid upstream RPC response');
    const pending = this.pending.get(frame.id);
    if (!pending) return; // Late response to a timed-out request; never replay it.
    clearTimeout(pending.timer); this.pending.delete(frame.id);
    if ('error' in frame) pending.reject(Error(`Upstream ${pending.method}: ${frame.error?.message ?? 'RPC error'}`));
    else pending.resolve(frame.result);
  }
  /** Delete before sending so competing browser responses cannot resolve twice. */
  respond(id: RpcId, result: unknown): boolean {
    if (!this.ready || !this.approvals.delete(id)) return false;
    this.socket!.send(JSON.stringify({ id, result }), error => { if (error && this.socket) this.fail(this.socket, error); });
    this.emit('resolved', id);
    return true;
  }
  private fail(socket: WebSocket, error: Error) {
    if (this.socket !== socket) return;
    this.socket = undefined; this.ready = false; this.serverInfo = undefined; this.approvals.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new DeliveryError(`${error.message}; request ${pending.method} may have executed`, 'unknown'));
    }
    this.pending.clear();
    socket.terminate();
    this.emit('disconnected', error);
  }
  close() { if (this.socket) this.fail(this.socket, Error('Host closed upstream')); }
}
