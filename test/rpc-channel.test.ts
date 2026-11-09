import test from 'node:test';
import assert from 'node:assert/strict';
import { RpcChannel } from '../src/rpc-channel.js';

test('lost acknowledgements and reconnect replay deliver each RPC instruction once', () => {
  const hostFrames: unknown[] = [], browserFrames: unknown[] = [];
  const host = new RpcChannel(frame => hostFrames.push(frame));
  const browser = new RpcChannel(frame => browserFrames.push(frame));
  const outbound: string[] = [], inbound: string[] = [];
  host.connect(packet => inbound.push(packet)); browser.connect(packet => outbound.push(packet));
  const pump = () => {
    while (outbound.length || inbound.length) {
      for (const packet of outbound.splice(0)) host.receive(packet);
      for (const packet of inbound.splice(0)) browser.receive(packet);
    }
  };
  pump(); browser.send(['mutation', 1]);
  host.receive(outbound.shift()!); // Delivery succeeds; its acknowledgement is lost.
  inbound.length = 0; host.disconnect(); browser.disconnect();
  host.send(['stream', 'while offline']); browser.send(['mutation', 2]);
  host.connect(packet => inbound.push(packet)); browser.connect(packet => outbound.push(packet)); pump();
  assert.deepEqual(hostFrames, [['mutation', 1], ['mutation', 2]]);
  assert.deepEqual(browserFrames, [['stream', 'while offline']]);
  host.disconnect(); browser.disconnect();
  host.connect(packet => inbound.push(packet)); browser.connect(packet => outbound.push(packet)); pump();
  assert.equal(hostFrames.length, 2); assert.equal(browserFrames.length, 1);
});

test('RPC recovery rejects invalid ordering, acknowledgements and buffer overflow', () => {
  const channel = new RpcChannel(() => {}, 64);
  assert.throws(() => channel.receive('{"ack":1}'), /acknowledgement/);
  assert.throws(() => channel.receive('{"ack":0,"seq":2,"payload":"null"}'), /gap/);
  assert.throws(() => channel.receive('{"ack":0,"seq":0,"payload":"null"}'), /sequence/);
  assert.throws(() => channel.send('x'.repeat(64)), /buffer/);
});

test('an unacknowledged slow subscriber is bounded without blocking another subscriber', () => {
  const slow = new RpcChannel(() => {}, 128);
  const received: unknown[] = [];
  const healthy = new RpcChannel(() => {});
  const browser = new RpcChannel(frame => received.push(frame));
  // Queue packets to model asynchronous WebSocket delivery.
  const packets: string[] = [], replies: string[] = [];
  healthy.connect(packet => packets.push(packet));
  browser.connect(packet => replies.push(packet));
  const pump = () => {
    while (packets.length || replies.length) {
      for (const packet of packets.splice(0)) browser.receive(packet);
      for (const packet of replies.splice(0)) healthy.receive(packet);
    }
  };
  pump();
  let bounded = false;
  for (let index = 0; index < 100; index++) {
    if (!bounded) {
      try { slow.send(['delta', index]); } catch { bounded = true; slow.disconnect(); }
    }
    healthy.send(['delta', index]); pump();
  }
  assert.equal(bounded, true);
  assert.equal(received.length, 100);
});
