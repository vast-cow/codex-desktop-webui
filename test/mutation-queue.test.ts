import test from 'node:test';
import assert from 'node:assert/strict';
import { MutationQueue } from '../src/mutation-queue.js';

test('thread mutations keep submission order while other threads proceed', async () => {
  const queue = new MutationQueue();
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = queue.run('same', async () => { events.push('first'); await gate; });
  const second = queue.run('same', async () => { events.push('second'); });
  await queue.run('other', async () => { events.push('other'); });
  assert.deepEqual(events, ['first', 'other']);
  release(); await Promise.all([first, second]);
  assert.deepEqual(events, ['first', 'other', 'second']);
  await assert.rejects(queue.run('same', async () => { throw Error('failed'); }), /failed/);
  assert.equal(await queue.run('same', async () => 'next submission'), 'next submission');
});
