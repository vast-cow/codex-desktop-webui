import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';

/** Protocol fixture only. Never represents verification against a user's server. */
export async function appServerFixture(socketPath: string, cwd: string, accountType: 'apiKey' | 'chatgpt' = 'apiKey', accountState?: { response: unknown; auth: unknown; timeout?: boolean }) {
  const server = createServer();
  const wss = new WebSocketServer({ server, path: '/rpc' });
  const frames: any[] = [];
  const thread: any = { id: '00000000-0000-4000-8000-000000000001', name: 'Fixture history',
    preview: 'Previous message', createdAt: 1, updatedAt: 2, cwd, path: `${cwd}/thread.jsonl`,
    modelProvider: 'openai', source: 'cli', cliVersion: '0.0.0', status: { type: 'idle' },
    ephemeral: false, turns: [{ id: 'history-turn', status: 'completed', error: null,
      items: [{ id: 'history-user', type: 'userMessage', content: [{ type: 'text', text: 'Previous message', text_elements: [] }] },
        { id: 'history-agent', type: 'agentMessage', text: 'Previous answer', phase: 'final_answer' }] }] };
  const notify = (method: string, params: any) => {
    const turn = thread.turns.find((turn: any) => turn.id === params.turnId);
    if (turn && method === 'item/started') turn.items.push(structuredClone(params.item));
    if (turn && method === 'item/agentMessage/delta') {
      const item = turn.items.find((item: any) => item.id === params.itemId); if (item) item.text += params.delta;
    }
    for (const peer of wss.clients) peer.send(JSON.stringify({ method, params }));
  };
  wss.on('connection', socket => socket.on('message', data => {
    const frame = JSON.parse(data.toString()); frames.push(frame);
    if (!frame.method) return;
    let result: any;
    switch (frame.method) {
      case 'initialize': result = { userAgent: 'webui-protocol-fixture/0.0.0' }; break;
      case 'initialized': return;
      case 'account/read': if (accountState?.timeout) return; if (accountState) { result = accountState.response; break; } result = { account: accountType === 'chatgpt' ? { type: 'chatgpt', email: 'fixture@example.invalid', planType: 'plus', workspaceName: 'Fixture' } : { type: 'apiKey' }, requiresOpenaiAuth: true }; break;
      case 'getAuthStatus': if (accountState) { result = accountState.auth; break; } result = { authMethod: accountType === 'chatgpt' ? 'chatgpt' : 'apikey' }; break;
      case 'account/gatewayOAuth/read': result = { required: false, status: 'notConfigured' }; break;
      case 'config/read': result = { config: { model: 'fixture-model', model_provider: 'openai', approval_policy: 'on-request' }, version: 'fixture', layers: [] }; break;
      case 'configRequirements/read': result = { requirements: null }; break;
      case 'experimentalFeature/list':
      case 'mcpServerStatus/list': result = { data: [], nextCursor: null }; break;
      case 'model/list': result = { data: [{ id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture', isDefault: true, supportedReasoningEfforts: [] }], nextCursor: null }; break;
      case 'thread/list': result = { data: [thread], nextCursor: null }; break;
      case 'thread/read': result = { thread }; break;
      case 'thread/resume': result = { thread, model: 'fixture-model', modelProvider: 'openai', cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, reasoningEffort: null }; break;
      case 'thread/loaded/list': result = { data: [thread.id], nextCursor: null }; break;
      case 'thread/turns/list': result = { data: thread.turns, nextCursor: null }; break;
      case 'thread/unsubscribe': result = {}; break;
      case 'thread/goal/get': result = { goal: null }; break;
      case 'turn/start': {
        const turn = { id: `turn-${thread.turns.length}`, status: 'inProgress', error: null, items: [] };
        thread.turns.push(turn); result = { turn };
        socket.send(JSON.stringify({ id: frame.id, result }));
        notify('turn/started', { threadId: thread.id, turn });
        return;
      }
      default: socket.send(JSON.stringify({ id: frame.id, error: { code: -32601, message: `Fixture has no method ${frame.method}` } })); return;
    }
    socket.send(JSON.stringify({ id: frame.id, result }));
  }));
  server.listen(socketPath); await once(server, 'listening');
  return { version: accountType === 'chatgpt' ? '0.166.0' : '0.127.0', frames, thread, wss, notify,
    approval(id: string) { for (const peer of wss.clients) peer.send(JSON.stringify({ id, method: 'item/commandExecution/requestApproval', params: { threadId: thread.id, turnId: thread.turns.at(-1).id, itemId: 'command', command: 'echo fixture', cwd, reason: 'Fixture approval' } })); },
    async close() { for (const socket of wss.clients) socket.terminate(); wss.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
