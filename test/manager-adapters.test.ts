import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HostState } from '../src/host-state.js';
import { managerAdapters } from '../src/manager-adapters.js';
import { Upstream } from '../src/upstream.js';
import { appServerFixture } from './support/app-server.js';

test('manager adapter uses actual upstream account/config and persists host-owned workspace state', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'manager-adapters-'));
  const fixture = await appServerFixture(join(directory, 'server.sock'), directory);
  const upstream = new Upstream({ socketPath: join(directory, 'server.sock') });
  const state = await HostState.open(join(directory, 'state'));
  const adapters = managerAdapters(state, upstream, directory);
  t.after(async () => { upstream.close(); await adapters.dispose(); await fixture.close(); await rm(directory, { recursive: true, force: true }); });
  await upstream.connect();
  const queue = adapters.options.runtime.queuedMessages;
  assert.equal(queue.automaticExecutionEnabled, true);
  assert.equal(queue.tryAcquireStartTurn('thread'), true);
  assert.equal(queue.tryAcquireStartTurn('thread'), false);
  queue.releaseStartTurn('thread');
  const lock = await queue.acquireSendLock('thread', 'message');
  assert.ok(lock);
  assert.equal(await queue.acquireSendLock('thread', 'message'), null);
  await lock.release(false);
  const retry = await queue.acquireSendLock('thread', 'message'); assert.ok(retry);
  await retry.release(true);
  assert.equal(await queue.acquireSendLock('thread', 'message'), null);
  assert.equal((await adapters.options.transport.sendRequest('account/read', { refreshToken: false })).account.type, 'apiKey');
  assert.equal(adapters.options.transport.getAppServerVersion(), undefined);
  const assignment = { projectId: 'temporary-project' };
  await adapters.options.threadProjectAssignments.setAssignment({ threadId: 'thread', assignment });
  await adapters.options.threadProjectAssignments.setProjectless({ threadId: 'thread', projectless: true });
  const reopened = await HostState.open(join(directory, 'state'));
  assert.deepEqual(reopened.readValue('thread-project-assignments'), { thread: assignment });
  assert.deepEqual(reopened.readValue('projectless-thread-ids'), ['thread']);
  const failures: any[] = [];
  const dispose = adapters.options.transport.addRequestLifecycleListener(event => failures.push(event));
  await assert.rejects(adapters.options.transport.sendRequest('missing'), /Fixture has no method/);
  assert.equal(failures.length, 1); dispose();
  assert.throws(() => adapters.options.threadExecution.executeDynamicToolCall(), /unavailable/);
  assert.throws(() => adapters.options.pendingThreadArchives.add(), /unavailable/);
});

test('manager auth transport cannot request or forward credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'manager-auth-'));
  const upstream = new Upstream({ serverUrl: 'ws://127.0.0.1:1/' });
  const calls: any[] = [];
  upstream.sendRequest = async (method, params) => {
    calls.push({ method, params });
    return method === 'getAuthStatus' ? { authMethod: 'chatgpt', authToken: 'secret' } : {
      account: { type: 'chatgpt', email: 'private@example.invalid', planType: 'plus', accessToken: 'secret' }, requiresOpenaiAuth: true };
  };
  const adapters = managerAdapters(await HostState.open(join(directory, 'state')), upstream, directory);
  t.after(async () => { await adapters.dispose(); await rm(directory, { recursive: true, force: true }); });
  const transport = adapters.options.transport;
  assert.deepEqual(await transport.sendRequest('getAuthStatus', { includeToken: true, refreshToken: true }), { authMethod: 'chatgpt' });
  const response = await transport.sendRequest('account/read');
  assert.doesNotMatch(JSON.stringify(response), /secret|private@|Token/);
  assert.deepEqual(calls, [{ method: 'getAuthStatus', params: { includeToken: false, refreshToken: false } }, { method: 'account/read', params: { refreshToken: false } }]);
});
