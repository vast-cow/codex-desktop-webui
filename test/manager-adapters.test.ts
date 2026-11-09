import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HostState } from '../src/host-state.js';
import { managerAdapters, sessionConfig } from '../src/manager-adapters.js';
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
  await assert.rejects(adapters.options.pendingThreadArchives.add('worktree', { cwd: directory, cleanupWorktree: true }), /unavailable/);
  await adapters.options.pendingThreadArchives.add('thread', { cwd: directory, cleanupWorktree: false });
  assert.deepEqual(state.readValue('pending-thread-archives'), { thread: { cwd: directory, cleanupWorktree: false } });
  await adapters.options.transport.sendRequest('thread/archive', { threadId: 'thread' });
  assert.deepEqual(state.readValue('pending-thread-archives'), {});
  await adapters.options.pendingThreadArchives.add('uncertain', { cwd: directory, cleanupWorktree: false });
  assert.deepEqual((await HostState.open(join(directory, 'state'))).readValue('pending-thread-archives'), {
    uncertain: { cwd: directory, cleanupWorktree: false }
  });
  await adapters.options.pendingThreadArchives.remove('uncertain');
  assert.ok((state.readValue('pending-thread-archives') as any).uncertain);
  await adapters.options.transport.sendRequest('thread/unarchive', { threadId: 'uncertain' });
  assert.deepEqual(state.readValue('pending-thread-archives'), {});
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

test('effective shell policy omits absent null fields and preserves configured values', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'manager-shell-'));
  const upstream = new Upstream({ serverUrl: 'ws://127.0.0.1:1/' });
  let policy: any = { inherit: null, exclude: null, include_only: null, set: null };
  upstream.sendRequest = async () => ({ config: { shell_environment_policy: policy, model: 'test' } });
  const adapters = managerAdapters(await HostState.open(join(directory, 'state')), upstream, directory);
  t.after(async () => { await adapters.dispose(); await rm(directory, { recursive: true, force: true }); });
  assert.deepEqual(await adapters.options.settings.readCodexConfig(directory), { model: 'test' });
  policy = { inherit: 'core', exclude: ['PRIVATE_*'], include_only: null, set: { EXAMPLE: 'value' }, ignore_default_excludes: false };
  assert.deepEqual((await adapters.options.settings.readCodexConfig(directory)).shell_environment_policy,
    { inherit: 'core', exclude: ['PRIVATE_*'], set: { EXAMPLE: 'value' }, ignore_default_excludes: false });
});

test('session config preserves explicit falsy values and invalid policy types', () => {
  assert.deepEqual(sessionConfig({ absent: null, nested: { absent: null, enabled: false, count: 0, value: '', list: [] }, shell_environment_policy: '' }),
    { nested: { enabled: false, count: 0, value: '', list: [] }, shell_environment_policy: '' });
});

test('submission admission survives restart and fences uncertain delivery', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'manager-delivery-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const upstream = new Upstream({ serverUrl: 'ws://127.0.0.1:1/' });
  const { DeliveryError } = await import('../src/upstream.js');
  upstream.sendRequest = async () => { throw new DeliveryError('Disconnected after dispatch', 'unknown'); };
  const state = await HostState.open(directory);
  const first = managerAdapters(state, upstream, directory);
  const queue = first.options.runtime.queuedMessages;
  const [lock, competing] = await Promise.all([queue.acquireSendLock('t', 'm'), queue.acquireSendLock('t', 'm')]);
  assert.ok(lock); assert.equal(competing, null);
  await assert.rejects(first.options.transport.sendRequest('turn/start', { threadId: 't' }), /after dispatch/);
  await lock.release(false);
  upstream.sendRequest = async () => ({ turn: { id: 'turn' } });
  const success = await queue.acquireSendLock('t', 'success');
  assert.ok(success);
  await first.options.transport.sendRequest('turn/start', { threadId: 't' });
  await success.release(true);
  // An interrupted process may leave a reservation without any release.
  assert.ok(await queue.acquireSendLock('t', 'interrupted'));
  await first.dispose();
  const second = managerAdapters(await HostState.open(directory), upstream, directory);
  t.after(() => second.dispose());
  assert.equal(await second.options.runtime.queuedMessages.acquireSendLock('t', 'm'), null);
  assert.equal(await second.options.runtime.queuedMessages.acquireSendLock('t', 'success'), null);
  assert.equal(await second.options.runtime.queuedMessages.acquireSendLock('t', 'interrupted'), null);
  const distinct = await second.options.runtime.queuedMessages.acquireSendLock('t', 'distinct');
  assert.ok(distinct);
  await distinct.release(false);
  upstream.sendRequest = async () => { throw new DeliveryError('Not connected', 'not-sent'); };
  const retry = await second.options.runtime.queuedMessages.acquireSendLock('t', 'distinct');
  assert.ok(retry);
  await assert.rejects(second.options.transport.sendRequest('turn/start', { threadId: 't' }), /Not connected/);
  await retry.release(false);
  assert.ok(await second.options.runtime.queuedMessages.acquireSendLock('t', 'distinct'));
});


test('lifecycle delivery is durable, conflicting mutations reject, and uncertain mutations never replay', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lifecycle-'));
  const state = await HostState.open(directory);
  const upstream = new Upstream({ serverUrl: 'ws://127.0.0.1:1/' });
  const { DeliveryError } = await import('../src/upstream.js');
  let calls = 0;
  let release!: () => void;
  upstream.sendRequest = async () => {
    calls++;
    await new Promise<void>(resolve => { release = resolve; });
    throw new DeliveryError('Disconnected after dispatch', 'unknown');
  };
  const first = managerAdapters(state, upstream, directory);
  t.after(async () => { await first.dispose(); await rm(directory, { recursive: true, force: true }); });
  await first.options.pendingThreadArchives.add('t', { cwd: directory, cleanupWorktree: false });
  const archive = first.options.transport.sendRequest('thread/archive', { threadId: 't' });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(first.options.transport.sendRequest('thread/unarchive', { threadId: 't' }), /in progress/);
  release();
  await assert.rejects(archive, /after dispatch/);
  const restarted = managerAdapters(await HostState.open(directory), upstream, directory);
  t.after(() => restarted.dispose());
  await assert.rejects(restarted.options.transport.sendRequest('thread/archive', { threadId: 't' }), /uncertain/);
  await assert.rejects(restarted.options.transport.sendRequest('thread/name/set', { threadId: 't', name: 'conflict' }), /uncertain/);
  assert.equal(calls, 1);
  assert.equal((state.readValue('thread-lifecycle-ledger') as any).t.status, 'unknown');
  assert.ok((state.readValue('pending-thread-archives') as any).t);
});


test('failed unarchive retains archive intent and acknowledged completion clears it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'lifecycle-failure-'));
  const state = await HostState.open(directory);
  const upstream = new Upstream({ serverUrl: 'ws://127.0.0.1:1/' });
  upstream.sendRequest = async () => { throw Error('Upstream rejected mutation'); };
  const adapters = managerAdapters(state, upstream, directory);
  t.after(async () => { await adapters.dispose(); await rm(directory, { recursive: true, force: true }); });
  await adapters.options.pendingThreadArchives.add('t', { cwd: directory, cleanupWorktree: false });
  await adapters.options.pendingThreadArchives.remove('t');
  await assert.rejects(adapters.options.transport.sendRequest('thread/unarchive', { threadId: 't' }), /rejected mutation/);
  assert.ok((state.readValue('pending-thread-archives') as any).t);
  assert.equal((state.readValue('thread-lifecycle-ledger') as any).t.status, 'failed');
  upstream.sendRequest = async () => ({});
  await adapters.options.transport.sendRequest('thread/unarchive', { threadId: 't' });
  assert.deepEqual(state.readValue('pending-thread-archives'), {});
  assert.equal(((await HostState.open(directory)).readValue('thread-lifecycle-ledger') as any).t.status, 'completed');
});

test('shared transport coalesces competing interruption RPCs over one upstream connection', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'interrupt-adapters-'));
  const fixture = await appServerFixture(join(directory, 'server.sock'), directory);
  const upstream = new Upstream({ socketPath: join(directory, 'server.sock') });
  const adapters = managerAdapters(await HostState.open(join(directory, 'state')), upstream, directory);
  t.after(async () => { upstream.close(); await adapters.dispose(); await fixture.close(); await rm(directory, { recursive: true, force: true }); });
  await upstream.connect();
  const transport = adapters.options.transport;
  const { turn } = await transport.sendRequest('turn/start', { threadId: fixture.thread.id, input: [] });
  const params = { threadId: fixture.thread.id, turnId: turn.id };
  let terminalEvents = 0;
  upstream.on('notification', frame => { if (frame.method === 'turn/completed') terminalEvents++; });
  await Promise.all([transport.sendRequest('turn/interrupt', params), transport.sendRequest('turn/interrupt', params)]);
  await transport.sendRequest('turn/interrupt', params);
  assert.equal(fixture.frames.filter(frame => frame.method === 'turn/interrupt').length, 1);
  assert.equal(terminalEvents, 1);
  assert.equal(fixture.thread.turns.at(-1).status, 'interrupted');
});
