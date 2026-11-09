import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Upstream } from '../../src/upstream.js';
import { chromium, expect } from '@playwright/test';
let phase = 'setup';
async function verify() {
    if (!process.env.CODEX_SERVER_VERSION || !(process.env.CODEX_SERVER_URL || process.env.CODEX_SOCKET_PATH))
        throw Error('Explicit target and version required');
    await mkdir('.generated/live-runs', { recursive: true });
    const run = await mkdtemp(resolve('.generated/live-runs/run-'));
    const workspace = join(run, 'workspace');
    await mkdir(workspace);
    const reportPath = join(run, 'report.json');
    const manifest = JSON.parse(await readFile('.generated/manifest.json', 'utf8'));
    const report: Record<string, any> = { date: new Date().toISOString(), serverVersion: process.env.CODEX_SERVER_VERSION, applicationVersion: manifest.applicationVersion, archiveSha256: manifest.archiveSha256, patches: manifest.patches, proofGate: 'not-passed', preparatoryConnections: 1 };
    const seed = new Upstream({ serverUrl: process.env.CODEX_SERVER_URL, socketPath: process.env.CODEX_SOCKET_PATH, upgradePath: process.env.CODEX_UPGRADE_PATH, timeoutMs: 60000 });
    let threadId = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await seed.connect();
        const created = await seed.sendRequest('thread/start', { cwd: workspace, approvalPolicy: 'untrusted', sandbox: 'workspace-write' });
        threadId = created.thread.id;
        const done = new Promise((resolve, reject) => { timer = setTimeout(() => reject(Error('Seed timeout')), 90000); seed.on('notification', frame => { if (frame.method === 'turn/completed' && frame.params.threadId === threadId)
            resolve(frame.params.turn.status); }); });
        await seed.sendRequest('turn/start', { threadId, input: [{ type: 'text', text: 'Reply with exactly: Plan 1 live seed. Do not use tools.', text_elements: [] }] });
        if (await done !== 'completed')
            throw Error('Seed failed');
    }
    finally {
        clearTimeout(timer);
        seed.close();
    }
    const child = spawn(process.execPath, ['dist/src/serve.js'], { env: { ...process.env, CODEX_WORKSPACE_ROOT: workspace, WEBUI_DATA_DIR: join(run, 'state'), HOST: '127.0.0.1', PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.resume();
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
        phase = 'host-startup';
        const origin = await new Promise<string>((resolve, reject) => { const timer = setTimeout(() => reject(Error('Host timeout')), 30000); child.stdout.on('data', d => { const m = d.toString().match(/listening on 127.0.0.1:(\d+)/); if (m) {
            clearTimeout(timer);
            resolve('http://127.0.0.1:' + m[1]);
        } }); child.on('exit', () => { clearTimeout(timer); reject(Error('Host exited')); }); child.on('error', () => { clearTimeout(timer); reject(Error('Host failed')); }); });
        browser = await chromium.launch();
        const firstContext = await browser.newContext();
        const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
        const first = await firstContext.newPage(), second = await secondContext.newPage();
        const route = origin + '/local/' + threadId;
        phase = 'initial-route';
        await first.goto(origin);
        await expect(first.getByRole('textbox').first()).toBeVisible({ timeout: 60000 });
        phase = 'history';
        await Promise.all([first.goto(route), second.goto(route)]);
        for (const page of [first, second])
            await expect(page.getByText('Plan 1 live seed.', { exact: true })).toBeVisible({ timeout: 60000 });
        console.log('history-two-contexts: passed');
        phase = 'approval';
        for (const page of [first, second])
            await page.evaluate(async () => {
                const chunkPath = '/assets/async/398566.8e977c1734.js';
            const chunk = await import(chunkPath), out: any = {};
                const require = { d(target: any, getters: any, values: any) { for (const [k, get] of Object.entries(getters))
                        Object.defineProperty(target, k, { get: get as () => any }); Object.assign(target, values); } };
                chunk.__webpack_modules__.Fkn8({}, out, require);
                const { port1, port2 } = new MessageChannel();
                const root = out.ab(port1);
                window.postMessage({ type: 'connect-app-host', port: port2 }, location.origin, [port2]);
                const services = await root.services;
                const account = await services.appServerManagers.openAccount('local');
                const manager = await new Promise<any>(resolve => { (window as any).liveRegistry = services.appServerManagers.subscribe('local', (event: any) => resolve(event.manager.dup())); });
                (window as any).liveRpc = { root, account, manager, approvals: [] };
                (window as any).liveApprovalLease = await manager.subscribe({ type: 'event', key: { hostId: 'local' }, event: 'approval-request', listener: (event: any) => (window as any).liveRpc.approvals.push({ conversationId: event.conversationId, requestId: event.requestId, kind: event.kind }) });
            });
        await first.evaluate(async ({ threadId, workspace }) => {
            await (window as any).liveRpc.account.sendRequest('turn/start', { threadId, approvalPolicy: 'untrusted', input: [{ type: 'text', text: `Use the shell tool once to write the text verified to ${JSON.stringify(workspace + '/approval-proof.txt')} with python3, modifying nothing else.`, text_elements: [] }] }, null);
        }, { threadId, workspace });
        let approval = false, conflict = false;
        try {
            for (const page of [first, second])
                await expect(page.getByRole('button', { name: /Allow once/ })).toBeVisible({ timeout: 45000 });
            approval = true;
            const request = await first.evaluate(() => (window as any).liveRpc.approvals.at(-1));
            if (request?.kind !== 'commandExecution')
                throw Error('Unexpected approval kind');
            const decisions = await Promise.allSettled([first, second].map((page, index) => page.evaluate(async ({ request, decision }) => {
                await (window as any).liveRpc.manager.replyWithCommandExecutionApprovalDecision(request.conversationId, request.requestId, decision);
            }, { request, decision: index === 0 ? 'accept' : 'decline' })));
            conflict = decisions.some(result => result.status === 'fulfilled');
            report.approvalDecisionAttempts = decisions.length;
            await expect.poll(async () => (await (await fetch(origin + '/manager-status')).json()).verificationEvents.approvalResponses).toBe(1);
            console.log('approval-two-contexts', JSON.stringify({ approval, conflict }));
        }
        catch {
            console.log('approval-unverified');
            if (await first.getByRole('button', { name: /Allow once/ }).count())
                await first.getByRole('button', { name: /Allow once/ }).click();
        }
        // Give the command response time to settle before submitting the streaming probe.
        await first.waitForTimeout(4000);
        phase = 'streaming';
        await first.getByRole('textbox', { name: 'Work with Codex' }).fill('Print two hundred sequential markers, each beginning STREAM-LINE- followed by a zero-padded three-digit counter. Do not use tools.');
        await first.getByRole('button', { name: 'Send', exact: true }).click();
        for (const page of [first, second])
            await expect(page.getByText(/STREAM-LINE-001/).last()).toBeVisible({ timeout: 90000 });
        const atClose = (await (await fetch(origin + '/manager-status')).json()).verificationEvents.streamDeltas;
        phase = 'disconnect-during-stream';
        await first.close();
        await expect.poll(async () => (await (await fetch(origin + '/manager-status')).json()).verificationEvents.streamDeltas, { timeout: 30000 }).toBeGreaterThan(atClose);
        await expect(second.getByText(/STREAM-LINE-200/).last()).toBeVisible({ timeout: 90000 });
        phase = 'reconnect';
        const reconnected = await firstContext.newPage();
        await reconnected.goto(route);
        await expect(reconnected.getByText(/STREAM-LINE-200/).last()).toBeVisible({ timeout: 60000 });
        const status = await (await fetch(origin + '/manager-status')).json();
        report.results = { initialRoute: true, history: true, streamVisibleBoth: true, approval, conflict, disconnectDuringStream: true, reconnect: true };
        report.counts = status.verificationEvents;
        report.accountStatus = status.accountStatus;
        report.disconnect = { streamDeltasAtClose: atClose, streamDeltasAfterRecovery: status.verificationEvents.streamDeltas };
        report.proofGate = status.accountStatus === 'acquired' && approval && conflict && status.verificationEvents.connections === 1 && status.verificationEvents.turnStartDispatches === 2 && status.verificationEvents.approvalResponses === 1 && status.verificationEvents.approvalsReceived === 1 ? 'passed' : 'not-passed';
        phase = 'complete';
    }
    catch {
        report.failedPhase = phase;
        process.exitCode = 1;
    }
    finally {
        report.completedAt = new Date().toISOString();
        await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
        console.log(`Live verification: ${report.proofGate}; report: ${reportPath}`);
        if (report.proofGate !== 'passed')
            process.exitCode = 1;
        await browser?.close();
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, 'exit');
            child.kill('SIGTERM');
            const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
            await exited;
            clearTimeout(timer);
        }
    }
}
void verify().catch(() => { console.error(`Live verification failed during ${phase}. No account details or conversation content logged.`); process.exitCode = 1; });
