import test from 'node:test';
import assert from 'node:assert/strict';
import { threadListReader } from '../src/thread-list.js';

test('concurrent readers share real cursors, deduplicate overlaps and order deterministically', async () => {
  const calls: any[] = [];
  const read = threadListReader(async (method, params) => {
    calls.push({ method, ...params });
    await new Promise(resolve => setTimeout(resolve, 5));
    return params.cursor === null
      ? { data: [{ id: 'b', updatedAt: 2 }, { id: 'a', updatedAt: 2 }], nextCursor: 'opaque-server-token' }
      : { data: [{ id: 'b', updatedAt: 1 }, { id: 'c', updatedAt: 0 }], nextCursor: null };
  });
  const params = { limit: 50, sortKey: 'updated_at' };
  const [first, second] = await Promise.all([read(params), read(params)]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.data.map((t: any) => t.id), ['a', 'b', 'c']);
  assert.deepEqual(calls.map(c => c.cursor), [null, 'opaque-server-token']);
  await read(params); // A new lease/refresh reads current server data, not a stale cache.
  assert.equal(calls.length, 4);
});

test('legacy response without pagination is returned once without invented cursors', async () => {
  let calls = 0;
  const read = threadListReader(async () => { calls++; return { data: [{ id: 'legacy', updatedAt: 1 }] }; });
  assert.deepEqual(await read({}), { data: [{ id: 'legacy', updatedAt: 1 }], nextCursor: null });
  assert.equal(calls, 1);
});

test('cyclic cursors fail without publishing partial history and can be retried', async () => {
  let calls = 0;
  const read = threadListReader(async () => { calls++; return { data: [], nextCursor: 'cycle' }; });
  await assert.rejects(read({}), /repeated cursor/);
  await assert.rejects(read({}), /repeated cursor/);
  assert.equal(calls, 4);
});
