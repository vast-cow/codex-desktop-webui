import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnInterruptions } from '../src/turn-interruptions.js';

test('competing stops and later repeats share delivery per upstream turn', async () => {
  const stops = new TurnInterruptions();
  const params = { threadId: 'thread', turnId: 'turn' };
  let count = 0;
  const dispatch = async () => { count++; return {}; };
  await Promise.all([stops.run(params, dispatch), stops.run(params, dispatch)]);
  await stops.run(params, dispatch);
  assert.equal(count, 1);
  await stops.run({ ...params, turnId: 'next' }, dispatch);
  assert.equal(count, 2);
});

test('uncertain failures are retained and the bounded ledger fails closed', async () => {
  const stops = new TurnInterruptions(1);
  const params = { threadId: 'thread', turnId: 'turn' };
  let count = 0;
  const dispatch = async () => { count++; throw Error('delivery unknown'); };
  await assert.rejects(stops.run(params, dispatch), /unknown/);
  await assert.rejects(stops.run(params, dispatch), /unknown/);
  await assert.rejects(stops.run({ ...params, turnId: 'next' }, dispatch), /full/);
  await assert.rejects(stops.run({}, dispatch), /requires/);
  assert.equal(count, 1);
});
