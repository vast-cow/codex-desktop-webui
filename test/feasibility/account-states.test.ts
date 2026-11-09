import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { appServerFixture } from '../support/app-server.js';

for (const mode of ['no-auth', 'unauthenticated', 'invalid', 'timeout'] as const) {
  test(`original renderer displays account state: ${mode}`, { timeout: 90000 }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'webui-account-'));
    const fixture = await appServerFixture(join(directory, 'server.sock'), directory, 'chatgpt', {
      response: mode === 'invalid' ? { account: {} } : { account: null, requiresOpenaiAuth: mode !== 'no-auth' },
      auth: { authMethod: null }, timeout: mode === 'timeout',
    });
    const child = spawn(process.execPath, ['dist/src/serve.js'], { env: { ...process.env,
      CODEX_SERVER_URL: undefined, CODEX_UPGRADE_PATH: '/rpc', CODEX_SOCKET_PATH: join(directory, 'server.sock'), CODEX_SERVER_VERSION: fixture.version,
      HOST: '127.0.0.1', PORT: '0', CODEX_WORKSPACE_ROOT: directory, WEBUI_DATA_DIR: join(directory, 'state'),
    }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.resume();
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    t.after(async () => {
      await browser?.close();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 5000); await exited; clearTimeout(timer);
      }
      await fixture.close(); await rm(directory, { recursive: true, force: true });
    });
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Account fixture host startup timed out')), 30000);
      let output = '';
      child.stdout.on('data', data => {
        output += data;
        const match = output.match(/listening on 127\.0\.0\.1:(\d+); manager ready/);
        if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(Error('Account fixture host exited')); });
    });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(origin);
    if (mode === 'no-auth') {
      await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator('[data-webui-account-status]')).toHaveCount(0);
      await expect.poll(async () => (await (await fetch(`${origin}/manager-status`)).json()).accountStatus).toBe('acquired');
    } else {
      const status = mode === 'unauthenticated' ? 'authentication-required' : mode === 'invalid' ? 'protocol-incompatible' : 'connection-unavailable';
      await expect(page.locator(`[data-webui-account-status="${status}"]`)).toBeVisible({ timeout: 30000 });
    }
    await expect(page.locator('#webui-compatibility-error')).toHaveCount(0);
  });
}
