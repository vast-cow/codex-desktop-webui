import test from 'node:test';
import assert from 'node:assert/strict';
import { HostScheduler } from '../src/scheduler.js';

test('unbound microtask adapter runs before timers and supports nested scheduling', async () => {
  const scheduler = new HostScheduler();
  const schedule = scheduler.scheduleMicrotask;
  const calls: string[] = [];
  schedule(() => { calls.push('first'); schedule(() => calls.push('nested')); });
  schedule(() => calls.push('second'));
  assert.equal(calls.length, 0);
  await new Promise<void>(resolve => scheduler.schedule(() => { calls.push('timer'); resolve(); }));
  assert.deepEqual(calls, ['first', 'second', 'nested', 'timer']);
  scheduler.dispose();
});

test('disposal suppresses queued microtasks including disposal inside a callback', async () => {
  const scheduler = new HostScheduler();
  const calls: string[] = [];
  scheduler.scheduleMicrotask(() => { calls.push('active'); scheduler.dispose(); });
  scheduler.scheduleMicrotask(() => calls.push('disposed'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['active']);
  scheduler.dispose();
  assert.throws(() => scheduler.scheduleMicrotask(() => {}), /disposed/);
});

test('cancellation and disposal leave no pending manager callbacks', async () => {
  const scheduler = new HostScheduler();
  const calls: string[] = [];
  const cancel = scheduler.schedule(() => calls.push('cancelled'), 0);
  cancel(); cancel();
  await new Promise<void>(resolve => scheduler.schedule(() => { calls.push('active'); resolve(); }, 0));
  scheduler.schedule(() => calls.push('disposed'), 0);
  scheduler.dispose();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(calls, ['active']);
  assert.throws(() => scheduler.schedule(() => {}), /disposed/);
});
