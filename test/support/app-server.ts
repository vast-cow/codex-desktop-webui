import { randomUUID } from 'node:crypto';
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
  const archived = new Set<string>();
  const threads = new Map([[thread.id, thread]]);
  const initialThread = thread;
  const notify = (method: string, params: any) => {
    const turn = threads.get(params.threadId)?.turns.find((turn: any) => turn.id === params.turnId);
    if (turn && method === 'item/started') turn.items.push(structuredClone(params.item));
    if (turn && method === 'item/agentMessage/delta') {
      const item = turn.items.find((item: any) => item.id === params.itemId); if (item) item.text += params.delta;
    }
    for (const peer of wss.clients) peer.send(JSON.stringify({ method, params }));
  };
  wss.on('connection', socket => socket.on('message', data => {
    const frame = JSON.parse(data.toString()); frames.push(frame);
    if (!frame.method) return;
    const thread = threads.get(frame.params?.threadId) ?? initialThread;
    let result: any;
    switch (frame.method) {
      case 'initialize': result = { userAgent: 'webui-protocol-fixture/0.0.0' }; break;
      case 'initialized': return;
      case 'account/read': if (accountState?.timeout) return; if (accountState) { result = accountState.response; break; } result = { account: accountType === 'chatgpt' ? { type: 'chatgpt', email: 'fixture@example.invalid', planType: 'plus', workspaceName: 'Fixture' } : { type: 'apiKey' }, requiresOpenaiAuth: true }; break;
      case 'getAuthStatus': if (accountState) { result = accountState.auth; break; } result = { authMethod: accountType === 'chatgpt' ? 'chatgpt' : 'apikey' }; break;
      case 'account/gatewayOAuth/read': result = { required: false, status: 'notConfigured' }; break;
      case 'config/read': result = { config: { model: 'fixture-model', model_provider: 'openai', approval_policy: 'on-request', default_permissions: ':read-only' }, version: 'fixture', layers: [] }; break;
      case 'configRequirements/read': result = { requirements: null }; break;
      case 'experimentalFeature/list':
      case 'mcpServerStatus/list': result = { data: [], nextCursor: null }; break;
      case 'permissionProfile/list': result = { data: [{ id: ':read-only', name: 'Read only', allowed: true }], nextCursor: null }; break;
      case 'model/list': result = { data: [{ id: 'fixture-model', model: 'fixture-model', displayName: 'Fixture', isDefault: true, supportedReasoningEfforts: [] }], nextCursor: null }; break;
      case 'thread/list': {
        const data = [...threads.values()].filter(thread => archived.has(thread.id) === (frame.params.archived === true)).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
        const offset = frame.params.cursor == null ? 0 : Number(frame.params.cursor);
        const limit = Math.min(frame.params.limit ?? 50, 20);
        result = { data: data.slice(offset, offset + limit), nextCursor: offset + limit < data.length ? String(offset + limit) : null }; break;
      }
      case 'thread/start': {
        const created = { ...thread, id: randomUUID(), name: null, turns: [], cwd: frame.params.cwd ?? cwd };
        threads.set(created.id, created);
        result = { thread: created, model: frame.params.model ?? 'fixture-model', modelProvider: 'openai', cwd: created.cwd,
          approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, reasoningEffort: null };
        socket.send(JSON.stringify({ id: frame.id, result })); notify('thread/started', { thread: created }); return;
      }
      case 'thread/name/set': thread.name = frame.params.name; result = {}; notify('thread/name/updated', { threadId: thread.id, threadName: thread.name }); break;
      case 'turn/interrupt': {
        const turn = thread.turns.find((turn: any) => turn.id === frame.params.turnId);
        if (turn) { turn.status = 'interrupted'; notify('turn/completed', { threadId: thread.id, turn }); }
        result = {}; break;
      }
      case 'thread/archive': archived.add(thread.id); result = {}; notify('thread/archived', { threadId: thread.id }); break;
      case 'thread/unarchive': archived.delete(thread.id); result = { thread }; notify('thread/unarchived', { threadId: thread.id }); break;
      case 'thread/read': result = { thread: { ...thread, turns: frame.params.includeTurns === false ? [] : thread.turns } }; break;
      case 'thread/resume': {
        const limit = frame.params.initialTurnsPage?.limit;
        const initialTurnsPage = limit == null ? undefined : {
          data: [...thread.turns].reverse().slice(0, limit).map((turn: any) => ({ ...turn, itemsView: 'full' })),
          nextCursor: thread.turns.length > limit ? String(limit) : null
        };
        result = { thread: { ...thread, turns: frame.params.excludeTurns || frame.params.includeTurns === false ? [] : thread.turns },
          ...(initialTurnsPage ? { initialTurnsPage } : {}), model: 'fixture-model', modelProvider: 'openai', cwd: thread.cwd,
          approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, reasoningEffort: null }; break;
      }
      case 'thread/loaded/list': result = { data: [thread.id], nextCursor: null }; break;
      case 'thread/turns/list': {
        const turns = [...thread.turns]; if (frame.params.sortDirection !== 'asc') turns.reverse();
        const offset = Number(frame.params.cursor ?? 0), limit = frame.params.limit ?? 5;
        const data = turns.slice(offset, offset + limit).map((turn: any) => ({ ...turn,
          itemsView: frame.params.itemsView === 'notLoaded' ? 'notLoaded' : 'full',
          items: frame.params.itemsView === 'notLoaded' ? [] : turn.items }));
        result = { data, nextCursor: offset + limit < turns.length ? String(offset + limit) : null }; break;
      }
      case 'thread/items/list': {
        const items = [...(thread.turns.find((turn: any) => turn.id === frame.params.turnId)?.items ?? [])];
        if (frame.params.sortDirection !== 'asc') items.reverse();
        const offset = Number(frame.params.cursor ?? 0), limit = frame.params.limit ?? 100;
        result = { data: items.slice(offset, offset + limit), nextCursor: offset + limit < items.length ? String(offset + limit) : null }; break;
      }
      case 'thread/unsubscribe': result = {}; break;
      case 'thread/goal/get': result = { goal: null }; break;
      case 'turn/steer': {
        result = { turnId: frame.params.expectedTurnId ?? thread.turns.at(-1).id }; break;
      }
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
  return { version: accountType === 'chatgpt' ? '0.166.0' : '0.127.0', frames, thread, threads, wss, notify,
    approval(id: string) { for (const peer of wss.clients) peer.send(JSON.stringify({ id, method: 'item/commandExecution/requestApproval', params: { threadId: thread.id, turnId: thread.turns.at(-1).id, itemId: 'command', command: 'echo fixture', cwd, reason: 'Fixture approval' } })); },
    async close() { for (const socket of wss.clients) socket.terminate(); wss.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
