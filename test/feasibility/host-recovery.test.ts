import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { appServerFixture } from '../support/app-server.js';

test('host broadcasts persisted settings and rebuilds one manager after upstream loss', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'webui-host-recovery-'));
  const socketPath = join(directory, 'upstream.sock');
  const fixture = await appServerFixture(socketPath, directory);
  const child = spawn(process.execPath, ['dist/src/serve.js'], { env: { ...process.env,
    HOST: '127.0.0.1', PORT: '0', CODEX_SERVER_URL: '', CODEX_SOCKET_PATH: socketPath,
    CODEX_SERVER_VERSION: '0.166.0', CODEX_WORKSPACE_ROOT: directory, WEBUI_DATA_DIR: join(directory, 'state') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const controller = new AbortController();
  t.after(async () => {
    controller.abort(); child.kill('SIGTERM');
    await new Promise<void>(resolve => { if (child.exitCode !== null) return resolve(); child.once('exit', () => resolve()); setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 6000).unref(); });
    await fixture.close(); await rm(directory, { recursive: true, force: true });
  });
  const deadline = Date.now() + 60000;
  while (!output.match(/listening on 127.0.0.1:(\d+)/)) {
    assert.ok(Date.now() < deadline, output); await delay(100);
  }
  const origin = `http://127.0.0.1:${output.match(/listening on 127.0.0.1:(\d+)/)![1]}`;
  const streams = await Promise.all([1, 2].map(() => fetch(`${origin}/bridge-events`, { signal: controller.signal })));
  const readers = streams.map(response => response.body!.getReader());
  for (const reader of readers) {
    let initial = '';
    while (!initial.includes('persisted-atom-sync')) initial += new TextDecoder().decode((await reader.read()).value);
  }
  const write = await fetch(`${origin}/bridge-message`, { method: 'POST', body: JSON.stringify({ type: 'persisted-atom-update', key: 'theme', value: 'dark' }) });
  assert.equal(write.status, 200);
  for (const reader of readers) {
    const frame = new TextDecoder().decode((await reader.read()).value);
    assert.match(frame, /persisted-atom-updated/); assert.match(frame, /dark/);
  }
  for (const socket of fixture.wss.clients) socket.terminate();
  const recoveryDeadline = Date.now() + 60000;
  while (fixture.frames.filter(frame => frame.method === 'initialize').length < 2 || !(await fetch(`${origin}/healthz`)).ok) {
    assert.ok(Date.now() < recoveryDeadline, output); await delay(200);
  }
  assert.equal(fixture.wss.clients.size, 1);
  const snapshot = await fetch(`${origin}/bridge-message`, { method: 'POST', body: JSON.stringify({ type: 'persisted-atom-sync-request' }) }).then(response => response.json()) as any;
  assert.equal(snapshot.events[0].state.theme, 'dark');
  assert.equal(fixture.frames.filter(frame => frame.method === 'turn/start').length, 0);
});
