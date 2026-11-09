import { encodeWire, decodeWire } from './wire.js';

/** Sequence the transport, retaining the existing RPC session during brief outages. */
export class RpcChannel {
  private sent = 0;
  private received = 0;
  private acknowledged = 0;
  private pending = new Map<number, string>();
  private bytes = 0;
  private transport?: (packet: string) => void;
  constructor(private deliver: (frame: unknown) => void, private limit = 8 * 1024 * 1024) {}
  connect(send: (packet: string) => void) {
    this.transport = send;
    send(JSON.stringify({ ack: this.received }));
    for (const [seq, payload] of this.pending) send(JSON.stringify({ seq, ack: this.received, payload }));
  }
  disconnect() { this.transport = undefined; }
  send(frame: unknown) {
    const payload = encodeWire(frame);
    if (this.bytes + payload.length * 2 > this.limit) throw Error('RPC recovery buffer exceeded');
    const seq = ++this.sent;
    this.pending.set(seq, payload); this.bytes += payload.length * 2;
    this.transport?.(JSON.stringify({ seq, ack: this.received, payload }));
  }
  receive(packet: string) {
    const value = JSON.parse(packet);
    if (!value || !Number.isSafeInteger(value.ack) || value.ack < this.acknowledged || value.ack > this.sent) throw Error('Invalid RPC acknowledgement');
    this.acknowledged = value.ack;
    for (const [seq, payload] of this.pending) if (seq <= value.ack) { this.pending.delete(seq); this.bytes -= payload.length * 2; }
    if (value.seq === undefined) return;
    if (!Number.isSafeInteger(value.seq) || value.seq < 1 || typeof value.payload !== 'string') throw Error('Invalid RPC sequence');
    if (value.seq > this.received + 1) throw Error('RPC sequence gap');
    if (value.seq === this.received + 1) {
      const frame = decodeWire(value.payload);
      this.deliver(frame);
      this.received = value.seq;
    }
    this.transport?.(JSON.stringify({ ack: this.received }));
  }
}
