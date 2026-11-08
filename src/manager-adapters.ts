import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HostState } from './host-state.js';
import { HostScheduler } from './scheduler.js';
import { Upstream, type RpcId } from './upstream.js';

export function unsupported(operation: string): never { throw Error(`Host operation unavailable: ${operation}`); }

/** Explicit Node services for the pinned manager, independent of browser leases. */
export function managerAdapters(state: HostState, upstream: Upstream, dataDirectory: string) {
  const scheduler = new HostScheduler();
  const requestListeners = new Set<(event: any) => void>();
  const unreadListeners = new Set<(event: any) => void>();
  const unread = new Set<string>((state.readValue('unread-thread-ids') as string[] | undefined) ?? []);
  const logger = Object.fromEntries(['trace', 'debug', 'info', 'warning', 'error'].map(level => [level, (message: string) => {
    if (level === 'error' || level === 'warning') console.error(`[manager:${level}] ${message}`);
  }]));
  const persist = (key: string, value: unknown) => { void state.writeValue(key, value).catch(error => console.error('Host state write failed:', error.message)); };
  const transport = {
    hostId: upstream.hostId,
    // The handshake is not a semantic server version. Unknown versions disable
    // version-gated features until the actual server supplies verified metadata.
    getAppServerVersion: () => undefined,
    getCompatibleThreadSortKey: (key: string) => key === 'recency_at' ? 'updated_at' : key,
    supportsPaginatedThreadHistory: () => false,
    getPendingRequestCount: upstream.getPendingRequestCount.bind(upstream),
    addRequestLifecycleListener(listener: (event: any) => void) { requestListeners.add(listener); return () => { requestListeners.delete(listener); }; },
    async sendRequest(method: string, params?: unknown, _options?: unknown) {
      try { return await upstream.sendRequest(method, params); }
      catch (error) { for (const listener of requestListeners) listener({ type: 'failed', hostId: upstream.hostId, method, error }); throw error; }
    }
  };
  const respond = (_method: string, response: { id: RpcId; result: unknown }) => upstream.respond(response.id, response.result);
  const storage = {
    readValue: state.readValue.bind(state), writeValue: state.writeValue.bind(state),
    readGlobalState: state.readGlobalState.bind(state), updateGlobalState: state.updateGlobalState.bind(state),
    readQueuedFollowUps: () => ({ isLoading: false, value: state.readValue('queued-follow-ups') ?? {} }),
    loadQueuedFollowUps: async () => state.readValue('queued-follow-ups') ?? {},
    updateQueuedFollowUps: (update: (value: any) => unknown) => state.updateGlobalState('queued-follow-ups', value => update(value ?? {}))
  };
  const savedReadState = {
    syncWithServer: false, isReady: () => true, has: (id: string) => unread.has(id),
    set(id: string, value: boolean) {
      if (value) unread.add(id); else unread.delete(id);
      persist('unread-thread-ids', [...unread]);
      for (const listener of unreadListeners) listener({ threadId: id, hasUnreadTurn: value });
    },
    subscribe(listener: (event: any) => void) { unreadListeners.add(listener); listener({ unreadThreadIds: [...unread] }); return () => { unreadListeners.delete(listener); }; }
  };
  const filesystem = {
    attachments: { createId: randomUUID,
      readFile: (path: string) => readFile(path),
      writeFile: (path: string, contents: string | Uint8Array) => writeFile(path, contents),
    },
    initialization: { hasDesktopRuntime: false,
      readCodexHome: async () => resolve(homedir(), '.codex'),
      readWorkspacesRoot: async () => resolve(dataDirectory, 'workspaces'),
      ensureDirectory: (path: string) => mkdir(path, { recursive: true }),
    },
    getVisualizationRoot: () => null,
    getOpenFileWatchPath: (cwd: string, path: string) => resolve(cwd, path),
    getCodexHome: () => resolve(homedir(), '.codex'),
    getWorkspacesRoot: () => resolve(dataDirectory, 'workspaces'),
    ensureDirectory: (path: string) => mkdir(path, { recursive: true }),
    createProjectlessThreadWorkspace: async () => {
      const path = resolve(dataDirectory, 'workspaces', randomUUID()); await mkdir(path, { recursive: true });
      return { cwd: path, workspaceRoot: path };
    },
  };
  const runtime = {
    hasDesktopRuntime: false, preserveWorkspaceSandboxPolicy: true,
    threadMode: () => 'default', parseUrl: (input: string) => { try { return new URL(input); } catch { return null; } },
    createAbortController: () => new AbortController(), accountId: () => null,
    isUsingCopilotInference: async () => false,
    queuedMessages: { requiresReplayAdmission: false, canAcquireOwnership: () => true },
  };
  const settings = {
    isBrowserRuntime: false,
    history: { canonicalTurnHistory: false, paginatedHistoryEnabled: false, useTailHydration: false,
      readCatalogConsumptionEnabled: () => false },
    readExperimentPersonality: async () => null,
    readFollowUpQueueMode: () => 'queue', readPermissionRefreshEnabled: () => true,
    readDefaultFeatureOverrides: () => ({}),
    readCodexConfig: async (cwd: string) => (await transport.sendRequest('config/read', { includeLayers: false, cwd })).config,
    fetchProxyConfig: async () => null,
    isTokenBudgetThread: (id: string) => state.readValue(`token-budget:${id}`) === true,
    readSettings: async (_model: string | null, cwd: string) => {
      const { config } = await transport.sendRequest('config/read', { includeLayers: false, cwd });
      return { personality: config.personality ?? null, defaultFeatureOverrides: {}, instructionOverrides: null, writingBlocks: false, includeProseDetailLevelInstructions: false };
    },
  };
  return {
    options: { hostId: upstream.hostId, transport, logger, scheduler, storage, savedReadState, filesystem, runtime, settings,
      pendingThreadArchives: { add: () => unsupported('deferred thread archives'), remove: () => unsupported('deferred thread archives') },
      threadProjectAssignments: {
        setAssignment: ({ threadId, assignment }: { threadId: string; assignment: unknown }) => state.updateGlobalState('thread-project-assignments', value => ({ ...value, [threadId]: assignment })),
        setProjectless: ({ threadId, projectless }: { threadId: string; projectless: boolean }) => state.updateGlobalState('projectless-thread-ids', value => {
          const ids = new Set<string>(value ?? []); if (projectless) ids.add(threadId); else ids.delete(threadId); return [...ids];
        }),
      },
      sendAppServerResponse: respond, sendApprovalResponse: respond,
      threadExecution: { executeDynamicToolCall: () => unsupported('desktop dynamic tools') },
    },
    async dispose() { scheduler.dispose(); requestListeners.clear(); unreadListeners.clear(); await state.flush(); }
  };
}
