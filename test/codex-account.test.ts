import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAccount } from '../src/codex-account.js';

const chatgpt = { account: { type: 'chatgpt', email: 'private@example.invalid', planType: 'plus', workspaceName: 'Test', accessToken: 'secret' }, requiresOpenaiAuth: true };
function service(response: any = chatgpt, auth: any = { authMethod: 'chatgpt', authToken: 'secret' }) {
  const calls: any[] = [];
  const source = { isReady: true, async sendRequest(method: string, params: unknown) { calls.push({ method, params }); return method === 'account/read' ? response : auth; } };
  return { account: new CodexAccount(source), calls, source };
}
for (const [name, response, auth, status] of [
  ['ChatGPT', chatgpt, { authMethod: 'chatgpt' }, 'acquired'],
  ['API key', { account: { type: 'apiKey' }, requiresOpenaiAuth: true }, { authMethod: 'apikey' }, 'acquired'],
  ['no auth required', { account: null, requiresOpenaiAuth: false }, { authMethod: null }, 'acquired'],
  ['unauthenticated', { account: null, requiresOpenaiAuth: true }, { authMethod: null }, 'authentication-required'],
  ['invalid', { account: {} }, {}, 'protocol-incompatible'],
] as const) test(`account state: ${name}`, async () => {
  const { account, calls } = service(response, auth);
  await account.refresh();
  assert.equal(account.read().status, status);
  assert.deepEqual(calls[1].params, { includeToken: false, refreshToken: false });
  assert.doesNotMatch(JSON.stringify(account.read()), /private@|secret|authToken|email|accountId|hasChatGptToken/);
});
test('two subscriptions receive snapshots, dispose independently, and reconnect', async () => {
  const { account } = service();
  const a: number[] = [], b: number[] = [];
  const dispose = account.subscribe(s => a.push(s.revision));
  account.subscribe(s => b.push(s.revision));
  await account.refresh(); dispose(); account.disconnect();
  assert.deepEqual(a, [0, 1, 2]); assert.deepEqual(b, [0, 1, 2, 3]);
  const c: number[] = []; account.subscribe(s => c.push(s.revision));
  await account.refresh(); assert.deepEqual(c, [3, 4, 5]);
});
test('updates and disconnect fence late responses; snapshots cannot mutate cache', async () => {
  let resolve!: (value: any) => void;
  const source = { isReady: true, sendRequest: (method: string) => method === 'account/read' ? new Promise(r => { resolve = r; }) : Promise.resolve({ authMethod: 'chatgpt' }) };
  const account = new CodexAccount(source);
  const old = account.refresh(); const finishOld = resolve;
  const latest = account.refresh(); resolve({ ...chatgpt, account: { type: 'chatgpt', planType: 'pro' } }); await latest;
  finishOld(chatgpt); await old;
  assert.equal(account.read().account?.planType, 'pro');
  const copy = account.read(); copy.account!.type = 'fake'; assert.equal(account.read().account?.type, 'chatgpt');
  const pending = account.refresh(); account.disconnect(); resolve(chatgpt); await pending;
  assert.equal(account.read().status, 'connection-unavailable'); assert.equal(account.read().account, null);
});
test('timeout clears identity without exposing upstream error', async () => {
  const account = new CodexAccount({ isReady: true, async sendRequest() { throw Error('timed out secret private@example.invalid'); } });
  await account.refresh(); assert.equal(account.read().status, 'connection-unavailable');
  assert.doesNotMatch(JSON.stringify(account.read()), /secret|private@/);
});
