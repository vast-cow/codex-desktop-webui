import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { appServerFixture } from '../support/app-server.js';

test('original renderer shares history, composer submission, approvals, and reconnect across browsers', { timeout: 120000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'webui-renderer-'));
  const fixture = await appServerFixture(join(directory, 'server.sock'), directory);
  const child = spawn(process.execPath, ['dist/src/serve.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0',
    CODEX_SOCKET_PATH: join(directory, 'server.sock'), CODEX_SERVER_VERSION: fixture.version,
    CODEX_UPGRADE_PATH: '/rpc', CODEX_WORKSPACE_ROOT: directory, WEBUI_DATA_DIR: join(directory, 'state') }, stdio: ['ignore', 'pipe', 'pipe'] });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let diagnostics = '';
  child.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-16000); });
  t.after(async () => {
    await browser?.close();
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer);
    }
    await fixture.close(); await rm(directory, { recursive: true, force: true });
  });
  const origin = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Fixture host did not start: ${diagnostics}`)), 30000);
    let output = '';
    child.stdout.on('data', data => { output += data; const match = output.match(/listening on 127\.0\.0\.1:(\d+); manager ready/); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); reject(Error(`Fixture host exited (${code}): ${diagnostics}`)); });
  });
  browser = await chromium.launch();
  const firstContext = await browser.newContext(), secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await firstContext.newPage(), second = await secondContext.newPage();
  const route = `${origin}/local/${fixture.thread.id}`;
  await Promise.all([first.goto(route), second.goto(route)]);
  for (const page of [first, second]) await expect(page.getByText('Previous answer', { exact: true })).toBeVisible({ timeout: 30000 });
  await first.getByRole('textbox', { name: 'Work with Codex' }).fill('Original renderer turn');
  await first.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => fixture.frames.filter(frame => frame.method === 'turn/start').length, { timeout: 15000 }).toBe(1);
  const turnId = fixture.thread.turns.at(-1).id;
  fixture.notify('item/started', { threadId: fixture.thread.id, turnId, item: { id: 'stream-agent', type: 'agentMessage', text: '', phase: 'commentary' } });
  fixture.notify('item/agentMessage/delta', { threadId: fixture.thread.id, turnId, itemId: 'stream-agent', delta: 'Rendered shared stream' });
  for (const page of [first, second]) await expect(page.getByText('Rendered shared stream', { exact: true })).toBeVisible();
  fixture.notify('item/started', { threadId: fixture.thread.id, turnId, item: { id: 'command', type: 'commandExecution', command: 'echo fixture', cwd: directory,
    status: 'inProgress', commandActions: [], aggregatedOutput: '', exitCode: null, durationMs: null } });
  fixture.approval('renderer-approval');
  for (const page of [first, second]) await expect(page.getByRole('button', { name: /Allow once/ })).toBeVisible();
  await first.getByRole('button', { name: /Allow once/ }).click();
  await expect.poll(() => fixture.frames.filter(frame => frame.id === 'renderer-approval' && !frame.method).length).toBe(1);
  assert.equal(fixture.frames.find(frame => frame.id === 'renderer-approval' && !frame.method).result.decision, 'accept');
  for (const page of [first, second]) await expect(page.getByRole('button', { name: /Allow once/ })).toHaveCount(0);
  await mkdir('.generated', { recursive: true });
  await first.screenshot({ path: '.generated/renderer-desktop.png' });
  await first.close();
  fixture.notify('item/agentMessage/delta', { threadId: fixture.thread.id, turnId, itemId: 'stream-agent', delta: ' after disconnect' });
  await expect(second.getByText('Rendered shared stream after disconnect', { exact: true })).toBeVisible();
  const reconnected = await firstContext.newPage(); await reconnected.goto(route);
  await expect(reconnected.getByText('Rendered shared stream after disconnect', { exact: true })).toBeVisible({ timeout: 30000 });
  await second.screenshot({ path: '.generated/renderer-narrow.png' });
  for (const page of [second, reconnected]) await expect(page.locator('#webui-compatibility-error')).toHaveCount(0);
  assert.equal(fixture.frames.filter(frame => frame.method === 'initialize').length, 1);
  assert.equal(fixture.frames.filter(frame => frame.method === 'turn/start').length, 1);
  assert.equal(fixture.frames.filter(frame => frame.id === 'renderer-approval' && !frame.method).length, 1);
  await writeFile('.generated/renderer-feasibility.json', JSON.stringify({ proofGate: 'not-passed', originalRendererFixtureWorkflow: 'passed',
    liveServer: 'not-tested', fixtureAccount: 'apiKey', fixtureVersion: fixture.version, viewports: [1280, 390], vendorRendererPatches: [] }, null, 2) + '\n');
});
