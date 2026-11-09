import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rendererServices } from '../src/renderer-services.js';
import { HostSettings } from '../src/host-settings.js';
import { HostState } from '../src/host-state.js';

test('settings persist and session disposal releases only its own callbacks exactly once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'renderer-settings-'));
  try {
    const state = await HostState.open(directory);
    const settings = new HostSettings(state);
    const binding = { RpcTarget: class {}, ManagerFacade: class {}, settings };
    const first = rendererServices(binding), second = rendererServices(binding);
    const a: any[] = [], b: any[] = [];
    let disposed = 0;
    function listener(events: any[]) {
      const callback: any = (value: any) => { events.push(value); };
      callback.dup = () => callback;
      callback[Symbol.dispose] = () => { disposed++; };
      return callback;
    }
    const lease = first.root.services.settings.subscribe('theme', listener(a));
    second.root.services.settings.subscribe('theme', listener(b));
    await new Promise(resolve => setImmediate(resolve));
    await settings.write('theme', 'dark');
    await new Promise(resolve => setImmediate(resolve));
    lease[Symbol.dispose](); first.dispose(); lease[Symbol.dispose]();
    assert.equal(disposed, 1);
    await settings.write('theme', 'light');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(a, [{ effective: undefined }, { effective: 'dark' }]);
    assert.deepEqual(b.at(-1), { effective: 'light' });
    assert.deepEqual(settings.readAll(), { values: { theme: 'light' } });
    assert.deepEqual(new HostSettings(await HostState.open(directory)).read('theme'), { effective: 'light' });
    assert.throws(() => settings.read(''), /Invalid setting key/);
    assert.throws(() => second.root.services.settings.subscribe('', listener([])), /Invalid setting key/);
    assert.equal(disposed, 2);
    second.dispose(); second.dispose();
    assert.equal(disposed, 3);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('projectless allocation is a waitable operation and thread navigation stays in its session', async () => {
  const navigations: string[][] = [[], []];
  let allocations = 0;
  const sessions = navigations.map(events => rendererServices({
    RpcTarget: class {}, ManagerFacade: class {},
    navigate: (path: string) => events.push(path),
    host: async (method: string) => {
      if (method === 'projectlessRoot') return '/host/workspaces';
      assert.equal(method, 'projectlessPaths');
      allocations++;
      return { cwd: '/host/workspaces/unique', workspaceRoot: '/host/workspaces/unique', outputDirectory: null };
    }
  }));
  const paths = sessions[0].root.services.projectlessThreads.createPaths({});
  assert.deepEqual(await paths.wait(), await paths.wait());
  assert.equal(allocations, 1);
  paths[Symbol.dispose]();
  assert.equal(await sessions[1].root.services.projectlessThreads.readWorkspaceRoot(), '/host/workspaces');
  sessions[0].root.services.hotkeyWindowHotkeys.open({ path: '/local/upstream-id' });
  assert.deepEqual(navigations, [['/local/upstream-id'], []]);
  for (const session of sessions) session.dispose();
});
