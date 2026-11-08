import test from 'node:test';
import assert from 'node:assert/strict';
import { HostScheduler } from '../src/scheduler.js';

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
