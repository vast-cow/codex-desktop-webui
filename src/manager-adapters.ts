import { threadListReader } from './thread-list.js';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HostState } from './host-state.js';
import { HostScheduler } from './scheduler.js';
import { DeliveryError, Upstream, type RpcId } from './upstream.js';

export function unsupported(operation: string): never { throw Error(`Host operation unavailable: ${operation}`); }

/** Effective config contains null placeholders that cannot be encoded as TOML session flags. */
export function sessionConfig(value: any): any {
  if (Array.isArray(value)) return value.map(sessionConfig);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== null)
    .map(([key, item]) => [key, sessionConfig(item)])
    .filter(([key, item]) => key !== 'shell_environment_policy' || typeof item !== 'object' || Array.isArray(item) || Object.keys(item as object).length > 0));
}

/** Explicit Node services for the pinned manager, independent of browser leases. */
export function managerAdapters(state: HostState, upstream: Upstream, dataDirectory: string, normalize: (value: any) => any = value => value, supportsHistory: (version?: string) => boolean = () => false) {
  const scheduler = new HostScheduler();
  const readThreadList = threadListReader(upstream.sendRequest.bind(upstream));
  const startingThreads = new Set<string>();
  const sendLocks = new Set<string>();
  const activeSends = new Map<string, { threadId: string; delivered: boolean }>();
  const ledgerKey = 'submission-delivery-ledger';
  const requestListeners = new Set<(event: any) => void>();
  const unreadListeners = new Set<(event: any) => void>();
  const unread = new Set<string>((state.readValue('unread-thread-ids') as string[] | undefined) ?? []);
  const logger = Object.fromEntries(['trace', 'debug', 'info', 'warning', 'error'].map(level => [level, (message: string, fields?: any) => {
    if (level === 'error' || level === 'warning') console.error(`[manager:${level}] ${message}`, fields?.sensitive?.error?.message ?? '');
  }]));
  const persist = (key: string, value: unknown) => { void state.writeValue(key, value).catch(error => console.error('Host state write failed:', error.message)); };
  const lifecycleMethods = new Set(['thread/name/set', 'thread/archive', 'thread/unarchive']);
  const lifecycleLocks = new Set<string>();
  const transport = {
    hostId: upstream.hostId,
    // The handshake is not a semantic server version. Unknown versions disable
    // version-gated features until the operator supplies the target version.
    getAppServerVersion: () => upstream.getSemanticVersion(),
    getCompatibleThreadSortKey: (key: string) => key === 'recency_at' ? 'updated_at' : key,
    supportsPaginatedThreadHistory: () => supportsHistory(upstream.getSemanticVersion()),
    getPendingRequestCount: upstream.getPendingRequestCount.bind(upstream),
    addRequestLifecycleListener(listener: (event: any) => void) { requestListeners.add(listener); return () => { requestListeners.delete(listener); }; },
    async sendRequest(method: string, params?: unknown, _options?: unknown) {
      try {
        if (method === 'thread/list' && (_options as any)?.source === 'recent_threads') return await readThreadList(params);
        if (method === 'getAuthStatus') {
          const value = await upstream.sendRequest(method, { includeToken: false, refreshToken: false });
          return { authMethod: value.authMethod };
        }
        if (method === 'account/read') {
          const value = await upstream.sendRequest(method, { refreshToken: false });
          const account = value.account == null ? null : Object.fromEntries(['type', 'planType', 'workspaceName']
            .filter(key => typeof value.account[key] === 'string').map(key => [key, value.account[key]]));
          return { account, requiresOpenaiAuth: value.requiresOpenaiAuth };
        }
        if (['thread/start', 'thread/resume', 'turn/start'].includes(method) && (params as any)?.config) {
          params = { ...(params as any), config: sessionConfig((params as any).config) };
        }
        try {
          const id = (params as any)?.threadId;
          const lifecycle = lifecycleMethods.has(method);
          if (lifecycle) {
            if (typeof id !== 'string' || !id) throw Error('Lifecycle operation requires a threadId');
            if (lifecycleLocks.has(id)) throw Error('A thread lifecycle operation is already in progress');
            lifecycleLocks.add(id);
          }
          let result;
          try {
            if (lifecycle) await state.updateGlobalState('thread-lifecycle-ledger', value => {
              const previous = value?.[id];
              if (previous && ['reserved', 'unknown'].includes(previous.status)) {
                throw Error('Thread lifecycle outcome is uncertain; inspect upstream state before another mutation');
              }
              return { ...value, [id]: { method, params, status: 'reserved' } };
            });
            try { result = await upstream.sendRequest(method, params); }
            catch (error) {
              if (lifecycle) await state.updateGlobalState('thread-lifecycle-ledger', value => ({ ...value,
                [id]: { method, params, status: error instanceof DeliveryError && error.outcome === 'unknown' ? 'unknown' : 'failed',
                  error: (error as Error).message } }));
              throw error;
            }
            if (lifecycle) {
              // A response acknowledges delivery. Read back the authoritative title;
              // archive membership is reconciled by the manager's notifications/list.
              await state.updateGlobalState('thread-lifecycle-ledger', value => ({ ...value,
                [id]: { method, params, status: 'completed' } }));
            }
          } finally { if (lifecycle) lifecycleLocks.delete(id); }
          if (method === 'thread/archive' || method === 'thread/unarchive') await clearPendingArchive((params as any).threadId);
          if (method === 'turn/start') for (const send of activeSends.values()) {
            if (send.threadId === (params as any)?.threadId) send.delivered = true;
          }
          return result;
        } catch (error) {
          if (method === 'turn/start' && error instanceof DeliveryError && error.outcome === 'unknown') {
            for (const send of activeSends.values()) if (send.threadId === (params as any)?.threadId) send.delivered = true;
          }
          throw error;
        }
      }
      catch (error) { for (const listener of requestListeners) listener({ type: 'failed', hostId: upstream.hostId, method, error }); throw error; }
    }
  };
  const respond = (_method: string, response: { id: RpcId; result: unknown }) => upstream.respond(response.id, response.result);
  const storage = {
    readValue: (key: string) => normalize(state.readValue(key)), writeValue: state.writeValue.bind(state),
    readGlobalState: async (key: string) => normalize(await state.readGlobalState(key)),
    updateGlobalState: (key: string, update: (value: any) => unknown) => state.updateGlobalState(key, value => update(normalize(value))),
    readQueuedFollowUps: () => normalize({ isLoading: false, value: state.readValue('queued-follow-ups') ?? {} }),
    loadQueuedFollowUps: async () => normalize(state.readValue('queued-follow-ups') ?? {}),
    updateQueuedFollowUps: (update: (value: any) => unknown) => state.updateGlobalState('queued-follow-ups', value => update(normalize(value ?? {})))
  };
  const savedReadState = {
    syncWithServer: false, isReady: () => true, has: (id: string) => unread.has(id),
    set(id: string, value: boolean) {
      if (value) unread.add(id); else unread.delete(id);
      persist('unread-thread-ids', [...unread]);
      for (const listener of unreadListeners) listener(normalize({ threadId: id, hasUnreadTurn: value }));
    },
    subscribe(listener: (event: any) => void) { unreadListeners.add(listener); listener(normalize({ unreadThreadIds: [...unread] })); return () => { unreadListeners.delete(listener); }; }
  };
  const filesystem = {
    attachments: { createId: randomUUID,
      readFile: async (path: string) => normalize(await readFile(path)),
      writeFile: (path: string, contents: string | Uint8Array) => writeFile(path, contents),
    },
    initialization: { hasDesktopRuntime: false,
      readCodexHome: async () => resolve(homedir(), '.codex'),
      readWorkspacesRoot: async () => resolve(dataDirectory, 'workspaces'),
      ensureDirectory: (path: string) => mkdir(path, { recursive: true }),
    },
    // This host does not create or own Git worktrees. Never infer ownership from
    // arbitrary workspace paths when the renderer archives a thread.
    getManagedWorktreeRoots: async () => [],
    getConfiguredWorktreeRoot: async () => resolve(dataDirectory, 'worktrees'),
    getVisualizationRoot: () => null,
    getOpenFileWatchPath: (cwd: string, path: string) => resolve(cwd, path),
    getCodexHome: () => resolve(homedir(), '.codex'),
    getWorkspacesRoot: () => resolve(dataDirectory, 'workspaces'),
    ensureDirectory: (path: string) => mkdir(path, { recursive: true }),
    createProjectlessThreadWorkspace: async () => {
      const path = resolve(dataDirectory, 'workspaces', randomUUID()); await mkdir(path, { recursive: true });
      return normalize({ cwd: path, workspaceRoot: path });
    },
  };
  const runtime = {
    hasDesktopRuntime: false, preserveWorkspaceSandboxPolicy: true,
    // Execution belongs to the app server; there are no host-owned REPL jobs.
    killNodeReplExecutions: () => null,
    pinnedThreads: async () => null,
    threadMode: () => 'default', parseUrl: (input: string) => { try { return new URL(input); } catch { return null; } },
    createAbortController: () => new AbortController(), accountId: () => null,
    isUsingCopilotInference: async () => false,
    queuedMessages: {
      requiresReplayAdmission: false, automaticExecutionEnabled: true,
      canAcquireOwnership: () => upstream.isReady,
      isHostForConversation: (_id: string, hostId: string) => hostId === upstream.hostId,
      tryAcquireStartTurn(id: string) { if (startingThreads.has(id)) return false; startingThreads.add(id); return true; },
      releaseStartTurn(id: string) { startingThreads.delete(id); },
      async acquireSendLock(id: string, messageId: string) {
        const key = JSON.stringify([id, messageId]);
        if (sendLocks.has(key)) return null;
        sendLocks.add(key);
        let reserved = false;
        try {
          // Persist before admission: a process crash must never replay an uncertain send.
          await state.updateGlobalState(ledgerKey, value => {
            const ledger = value ?? {};
            if (Object.hasOwn(ledger, key)) return ledger;
            reserved = true;
            return { ...ledger, [key]: 'reserved' };
          });
        } catch (error) { sendLocks.delete(key); throw error; }
        if (!reserved) { sendLocks.delete(key); return null; }
        const delivery = { threadId: id, delivered: false };
        activeSends.set(key, delivery);
        let released = false;
        return { async release(sent: boolean) {
          if (released) return;
          released = true;
          try {
            await state.updateGlobalState(ledgerKey, value => {
              const ledger = { ...value };
              if (sent || delivery.delivered) ledger[key] = 'delivered-or-unknown';
              else delete ledger[key];
              return ledger;
            });
          } finally { activeSends.delete(key); sendLocks.delete(key); }
        } };
      }
    },
  };
  const settings = {
    isBrowserRuntime: false,
    history: { readThreadTimelineEnabled: () => false, canonicalTurnHistory: false, paginatedHistoryEnabled: true, get useTailHydration() { return transport.supportsPaginatedThreadHistory(); },
      readCatalogConsumptionEnabled: () => false },
    readExperimentPersonality: async () => null,
    readFollowUpQueueMode: () => 'queue', readPermissionRefreshEnabled: () => true,
    readDefaultFeatureOverrides: () => normalize({}),
    readCodexConfig: async (cwd: string) => {
      return normalize(sessionConfig((await transport.sendRequest('config/read', { includeLayers: false, cwd })).config));
    },
    fetchProxyConfig: async () => null,
    isTokenBudgetThread: (id: string) => state.readValue(`token-budget:${id}`) === true,
    readSettings: async (_model: string | null, cwd: string) => {
      const { config } = await transport.sendRequest('config/read', { includeLayers: false, cwd });
      return normalize({ personality: config.personality ?? null, defaultFeatureOverrides: {}, instructionOverrides: null, writingBlocks: false, includeProseDetailLevelInstructions: false });
    },
  };
  const clearPendingArchive = (id: string) => state.updateGlobalState('pending-thread-archives', value => {
    const next = { ...value }; delete next[id]; return next;
  });
  const pendingThreadArchives = {
    async add(id: string, options: { cwd: string; cleanupWorktree: boolean; silent?: boolean }) {
      if (options.cleanupWorktree) unsupported('archive with managed worktree cleanup');
      const previous = (state.readValue('thread-lifecycle-ledger') as any)?.[id];
      if (previous && ['reserved', 'unknown'].includes(previous.status)) {
        throw Error('Thread lifecycle outcome is uncertain; inspect upstream state before changing archive intent');
      }
      await state.updateGlobalState('pending-thread-archives', value => ({ ...value, [id]: options }));
    },
    // The vendor calls remove before unarchive delivery; only acknowledged
    // transport completion may discard a durable archive intent.
    remove: async (_id: string) => {}
  };
  return {
    options: { hostId: upstream.hostId, transport, logger, scheduler, storage, savedReadState, filesystem, runtime, settings,
      pendingThreadArchives,
      threadProjectAssignments: {
        setAssignment: ({ threadId, assignment }: { threadId: string; assignment: unknown }) => state.updateGlobalState('thread-project-assignments', value => ({ ...value, [threadId]: assignment })),
        setProjectless: ({ threadId, projectless }: { threadId: string; projectless: boolean }) => state.updateGlobalState('projectless-thread-ids', value => {
          const ids = new Set<string>(value ?? []); if (projectless) ids.add(threadId); else ids.delete(threadId); return [...ids];
        }),
      },
      sendAppServerResponse: respond, sendApprovalResponse: respond,
      threadExecution: { executeDynamicToolCall: () => unsupported('desktop dynamic tools') },
    },
    async dispose() { scheduler.dispose(); startingThreads.clear(); sendLocks.clear(); activeSends.clear(); requestListeners.clear(); unreadListeners.clear(); await state.flush(); }
  };
}
