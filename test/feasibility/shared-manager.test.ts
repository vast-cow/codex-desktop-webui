import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { chromium, expect, type Page } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { appServerFixture } from '../support/app-server.js';
import { SharedManager } from '../../src/shared-manager.js';
import { createAssetHost } from '../../src/asset-host.js';

async function connect(page: Page, origin: string) {
  await page.route('**/__feasibility', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><title>Shared manager protocol test</title><body>Shared manager protocol test<script type="module" src="/bridge.js"></script>' }));
  await page.goto(`${origin}/__feasibility`);
  await page.waitForFunction(() => !!(window as any).electronBridge);
  await page.evaluate(async () => {
    // Invoke only the inert RPC factory, never a renderer or Electron entry.
    const chunkPath = '/assets/async/398566.8e977c1734.js';
    const chunk = await import(chunkPath);
    const exports: any = {};
    const require = { d(target: any, getters: any, values: any) {
      for (const [key, get] of Object.entries(getters)) Object.defineProperty(target, key, { get: get as () => any });
      Object.assign(target, values);
    } };
    chunk.__webpack_modules__.Fkn8({}, exports, require);
    const { port1, port2 } = new MessageChannel();
    const root = exports.ab(port1);
    window.postMessage({ type: 'connect-app-host', port: port2 }, location.origin, [port2]);
    const services = await root.services;
    const state: any = { root, services, notifications: [], approvals: [], leases: [] };
    (window as any).feasibility = state;
    state.accountUpdates = [];
    state.accountLease = await services.codexAccount.subscribe((snapshot: any) => state.accountUpdates.push(snapshot));
    state.manager = await new Promise((resolve, reject) => {
      state.pendingRegistry = services.appServerManagers.subscribe('local', (event: any) => resolve(event.manager.dup()));
      state.pendingRegistry.then((lease: any) => state.leases.push(lease), reject);
    });
    state.leases.push(await state.manager.subscribe({ type: 'notification', key: { hostId: 'local' },
      methods: ['item/agentMessage/delta'], listener: (event: any) => { state.notifications.push(event); } }));
    state.leases.push(await state.manager.subscribe({ type: 'event', key: { hostId: 'local' },
      event: 'approval-request', listener: (event: any) => { state.approvals.push(event); } }));
  });
}

test('two browsers share vendor history, turns, streaming, approval arbitration, and reconnect', { timeout: 90000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'webui-feasibility-'));
  const fixture = await appServerFixture(join(directory, 'server.sock'), directory);
  let manager: SharedManager | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let server: Awaited<ReturnType<typeof createAssetHost>> | undefined;
  let sockets: WebSocketServer | undefined;
  t.after(async () => {
    await browser?.close();
    for (const socket of sockets?.clients ?? []) socket.terminate(); sockets?.close();
    if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
    await manager?.close(); await fixture.close(); await rm(directory, { recursive: true, force: true });
  });
  manager = await SharedManager.start(resolve('.generated'), join(directory, 'state'), { socketPath: join(directory, 'server.sock') });
  const connection = await manager.hostRequest({ type: 'request-app-server-state' });
  assert.equal(connection.events[0].state, 'connected');
  assert.equal(connection.events[1].appServerVersion, null);
  await Promise.all(['first', 'second'].map(key => manager!.hostRequest({ type: 'persisted-atom-update', key: 'drafts', recordUpdate: { entries: { [key]: { value: key } } } })));
  await manager.hostRequest({ type: 'persisted-atom-update', key: 'drafts', recordUpdate: { entries: { first: { delete: true, expectedValue: 'stale' } } } });
  const persisted = await manager.hostRequest({ type: 'persisted-atom-sync-request' });
  assert.deepEqual(persisted.events[0].state.drafts, { first: 'first', second: 'second' });
  server = await createAssetHost(resolve('.generated'));
  sockets = new WebSocketServer({ server, path: '/app-host' });
  sockets.on('connection', socket => manager!.attach(socket));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  // Chromium treats Playwright-fulfilled test documents as public-network pages.
  // Disable that test-only classification; production documents come from HTTP.
  browser = await chromium.launch({ args: ['--disable-features=LocalNetworkAccessChecks,LocalNetworkAccessChecksWebSockets'] });
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await firstContext.newPage(), second = await secondContext.newPage();
  await connect(first, origin); await connect(second, origin);
  await first.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' })));
  await expect(first.locator('#webui-compatibility-error')).toHaveCount(0);
  assert.equal(fixture.wss.clients.size, 1);
  for (const page of [first, second]) await expect.poll(() => page.evaluate(() => (window as any).feasibility.accountUpdates.at(-1)?.status)).toBe('acquired');
  await first.evaluate(() => { (window as any).feasibility.accountLease[Symbol.dispose](); });
  fixture.notify('account/updated', { authMode: 'apikey' });
  await expect.poll(() => second.evaluate(() => (window as any).feasibility.accountUpdates.length)).toBeGreaterThan(1);
  await first.evaluate(async () => {
    const m = (window as any).feasibility.manager;
    await m.refreshRecentConversations();
    const snapshot = await m.getCachedThreadSearchSnapshot();
    const entry = snapshot.conversations[0].summary;
    const resumed = await m.resumeConversation({ conversationId: entry.conversationId, workspaceRoots: [entry.cwd], model: null,
      reasoningEffort: null, collaborationMode: null, intent: 'open', useAppServerPermissionDefault: true });
    if (resumed.status !== 'ready') throw Error(`Resume failed: ${resumed.reason}`);
  });
  const history = await second.evaluate(async id => await (window as any).feasibility.manager.getLoadedConversationHistory(id), fixture.thread.id);
  assert.match(JSON.stringify(history), /Previous answer/);
  await first.evaluate(async id => await (window as any).feasibility.manager.startTurn(id, {
    request: { threadId: id, input: [{ type: 'text', text: 'Fixture turn', text_elements: [] }], clientUserMessageId: 'fixture-submission' },
    context: { useAppServerPermissionDefault: true }
  }), fixture.thread.id);
  await assert.rejects(second.evaluate(async id => await (window as any).feasibility.manager.startTurn(id, {
    request: { threadId: id, input: [{ type: 'text', text: 'Fixture turn', text_elements: [] }], clientUserMessageId: 'fixture-submission' },
    context: { useAppServerPermissionDefault: true }
  }), fixture.thread.id), /already admitted/);
  assert.equal(fixture.frames.filter(frame => frame.method === 'turn/start').length, 1);
  const turnId = fixture.thread.turns.at(-1).id;
  fixture.notify('item/started', { threadId: fixture.thread.id, turnId, item: { id: 'stream-agent', type: 'agentMessage', text: '', phase: 'final_answer' } });
  fixture.notify('item/agentMessage/delta', { threadId: fixture.thread.id, turnId, itemId: 'stream-agent', delta: 'Shared stream' });
  for (const page of [first, second]) await expect.poll(() => page.evaluate(() => (window as any).feasibility.notifications.length)).toBe(1);
  fixture.approval('competing-approval');
  for (const page of [first, second]) await expect.poll(() => page.evaluate(() => (window as any).feasibility.approvals.length)).toBe(1);
  await Promise.all([first, second].map((page, index) => page.evaluate(async ({ id, decision }) => await (window as any).feasibility.manager.replyWithCommandExecutionApprovalDecision(id, 'competing-approval', decision), { id: fixture.thread.id, decision: index === 0 ? 'accept' : 'decline' })));
  await expect.poll(() => fixture.frames.filter(frame => frame.id === 'competing-approval' && !frame.method).length).toBe(1);
  await first.close();
  fixture.notify('item/agentMessage/delta', { threadId: fixture.thread.id, turnId, itemId: 'stream-agent', delta: ' after disconnect' });
  await expect.poll(() => second.evaluate(() => (window as any).feasibility.notifications.length)).toBe(2);
  const reconnected = await firstContext.newPage(); await connect(reconnected, origin);
  const recovered = await reconnected.evaluate(async id => await (window as any).feasibility.manager.getLoadedConversationHistory(id), fixture.thread.id);
  assert.match(JSON.stringify(recovered), /Shared stream after disconnect/);
  assert.equal(fixture.frames.filter(frame => frame.method === 'initialize').length, 1);
  assert.equal(fixture.frames.filter(frame => frame.method === 'turn/start').length, 1);
  await mkdir('.generated', { recursive: true });
  await writeFile('.generated/feasibility.json', JSON.stringify({ proofGate: 'not-passed', fixtureWorkflow: 'passed',
    liveServer: 'not-tested', originalRendererWorkflow: 'see renderer-feasibility.json', checks: ['two browser contexts', 'one upstream', 'nonempty history', 'vendor turn submission', 'streaming', 'first approval wins', 'browser reconnect'] }, null, 2) + '\n');
});
