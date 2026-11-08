import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocketServer, type WebSocket } from 'ws';
import { Upstream, DeliveryError } from '../src/upstream.js';

async function fixture(t: any, initialize: unknown = { userAgent: 'test/1' }) {
  const root = await mkdtemp(join(tmpdir(), 'webui-rpc-'));
  const socketPath = join(root, 'server.sock');
  const server = createServer();
  const wss = new WebSocketServer({ server, path: '/rpc' });
  const frames: any[] = [];
  let peer: WebSocket;
  wss.on('connection', socket => {
    peer = socket;
    socket.on('message', data => {
      const frame = JSON.parse(data.toString()); frames.push(frame);
      if (frame.method === 'initialize') socket.send(JSON.stringify({ id: frame.id, result: initialize }));
      if (frame.method === 'echo') socket.send(JSON.stringify({ id: frame.id, result: frame.params }));
    });
  });
  server.listen(socketPath); await once(server, 'listening');
  const client = new Upstream({ socketPath, timeoutMs: 500 });
  t.after(async () => { client.close(); for (const peer of wss.clients) peer.terminate(); await new Promise<void>(resolve => server.close(() => resolve())); await rm(root, { recursive: true, force: true }); });
  return { client, socketPath, frames, peer: () => peer! };
}
test('one connection initializes once and correlates concurrent requests', async t => {
  const { client, frames } = await fixture(t);
  await Promise.all([client.connect(), client.connect()]);
  assert.deepEqual(await Promise.all([client.sendRequest('echo', { a: 1 }), client.sendRequest('echo', { b: 2 })]), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(frames.slice(0, 2).map(f => f.method), ['initialize', 'initialized']);
  assert.equal(frames.filter(f => f.method === 'initialize').length, 1);
  assert.equal(client.getPendingRequestCount(), 0);
});
test('competing approval responses are arbitrated once', async t => {
  const { client, peer, frames } = await fixture(t); await client.connect();
  const request = once(client, 'request');
  peer().send(JSON.stringify({ id: 'approval', method: 'item/commandExecution/requestApproval', params: {} }));
  await request;
  assert.equal(client.respond('approval', { decision: 'accept' }), true);
  assert.equal(client.respond('approval', { decision: 'decline' }), false);
  await client.sendRequest('echo', null);
  assert.equal(frames.filter(f => f.id === 'approval').length, 1);
});
test('disconnect marks sent outcomes unknown and never replays them', async t => {
  const { client, peer, frames } = await fixture(t); await client.connect();
  const delivered = once(peer(), 'message');
  const pending = client.sendRequest('turn/start', {});
  const rejected = assert.rejects(pending, (e: any) => e instanceof DeliveryError && e.outcome === 'unknown');
  await delivered; peer().terminate(); await rejected;
  await assert.rejects(client.sendRequest('turn/start'), (e: any) => e.outcome === 'not-sent');
  await client.connect(); await client.sendRequest('echo', null);
  assert.equal(frames.filter(f => f.method === 'turn/start').length, 1);
});
test('rejects incompatible initialization and incorrect upgrade paths', async t => {
  const { client, socketPath } = await fixture(t, { unexpected: true });
  await assert.rejects(client.connect(), /Incompatible initialize/);
  const wrong = new Upstream({ socketPath, upgradePath: '/wrong', timeoutMs: 500 });
  t.after(() => wrong.close());
  await assert.rejects(wrong.connect(), /Unexpected server response/);
});
test('reports missing sockets and requires explicit configuration', async () => {
  assert.throws(() => new Upstream({ socketPath: '' }), /explicit absolute/);
  assert.throws(() => new Upstream({ socketPath: '/tmp/x', serverVersion: 'unknown' }), /semantic version/);
  assert.equal(new Upstream({ socketPath: '/tmp/x', serverVersion: '0.149.0-alpha.4.3' }).getSemanticVersion(), '0.149.0-alpha.4.3');
  assert.throws(() => new Upstream({ socketPath: '/tmp/x', upgradePath: '//remote' }), /upgrade path/);
  const client = new Upstream({ socketPath: '/nonexistent-webui-test/server.sock', timeoutMs: 500 });
  await assert.rejects(client.connect(), /ENOENT/); client.close();
});
test('malformed frames fail pending requests instead of hanging', async t => {
  const { client, peer } = await fixture(t); await client.connect();
  const pending = client.sendRequest('turn/start');
  const rejected = assert.rejects(pending, /Invalid upstream RPC envelope/);
  peer().send('[]'); await rejected;
});
