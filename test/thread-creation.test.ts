import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostState } from '../src/host-state.js';
import { ThreadCreation } from '../src/thread-creation.js';

test('creation shares concurrent requests and preserves results and uncertain reservations after restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'thread-creation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const admission = new ThreadCreation(await HostState.open(directory));
  let calls = 0;
  const dispatch = async () => { calls++; return { status: 'created', conversationId: 'upstream-id' }; };
  const options = { clientUserMessageId: 'one' };
  assert.deepEqual(await Promise.all([admission.run(options, dispatch), admission.run(options, dispatch)]),
    [{ status: 'created', conversationId: 'upstream-id' }, { status: 'created', conversationId: 'upstream-id' }]);
  const restarted = new ThreadCreation(await HostState.open(directory));
  assert.equal((await restarted.run(options, dispatch)).conversationId, 'upstream-id');
  assert.equal(calls, 1);
  await assert.rejects(restarted.run({ clientUserMessageId: 'lost' }, async () => { throw Error('lost response'); }), /lost response/);
  const recovered = new ThreadCreation(await HostState.open(directory));
  await assert.rejects(recovered.run({ clientUserMessageId: 'lost' }, dispatch), /uncertain/);
  await recovered.run({ clientUserMessageId: 'distinct' }, dispatch);
  await assert.rejects(recovered.run({}, dispatch), /stable/);
  assert.equal(calls, 2);
});
