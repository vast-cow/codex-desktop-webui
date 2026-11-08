import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { HostState } from '../src/host-state.js';

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'webui-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, state: await HostState.open(root) };
}
test('serializes simultaneous updates and persists state across reopening', async t => {
  const { root, state } = await fixture(t);
  await Promise.all(Array.from({ length: 20 }, () => state.updateGlobalState('counter', value => (value ?? 0) + 1)));
  const reopened = await HostState.open(root);
  assert.equal(reopened.readValue('counter'), 20);
  assert.equal(reopened.snapshot().revision, 20);
  assert.equal((await stat(join(root, 'webui-state.json'))).mode & 0o777, 0o600);
});
test('snapshot precedes updates and browser disposal leaves other subscriptions active', async t => {
  const { state } = await fixture(t);
  const first: number[] = [], second: number[] = [];
  const release = state.subscribe(snapshot => first.push(snapshot.revision));
  state.subscribe(snapshot => second.push(snapshot.revision));
  await state.write('project', { root: '/tmp/example' });
  release(); await state.write('project', { root: '/tmp/other' });
  assert.deepEqual(first, [0, 1]); assert.deepEqual(second, [0, 1, 2]);
  const value: any = state.readValue('project'); value.root = 'changed';
  assert.deepEqual((await state.read('project')).value, { root: '/tmp/other' });
});
test('failed writes do not publish state and do not poison the update queue', async t => {
  const { state } = await fixture(t);
  await assert.rejects(state.write('invalid', 1n), /BigInt/);
  assert.equal(state.snapshot().revision, 0);
  await state.write('__proto__', { retained: true });
  assert.deepEqual(state.readValue('__proto__'), { retained: true });
});
test('corrupt persistent state fails explicitly instead of being discarded', async t => {
  const { root } = await fixture(t);
  await writeFile(join(root, 'webui-state.json'), '{');
  await assert.rejects(HostState.open(root), SyntaxError);
});
