/** Evaluated in the vendor VM so Cap'n Web sees its own object prototypes. */
export function rendererServices(bindings: any) {
  const { RpcTarget, ManagerFacade, manager, host, appInfo } = bindings;
  const cleanups = new Set<() => void>();
  class Lease extends RpcTarget {
    private cleanup?: () => void;
    constructor(cleanup: () => void) { super(); this.cleanup = cleanup; cleanups.add(cleanup); }
    [Symbol.dispose]() { if (this.cleanup) { const cleanup = this.cleanup; this.cleanup = undefined; cleanups.delete(cleanup); cleanup(); } }
  }
  class Account extends RpcTarget {
    sendRequest(method: string, params: unknown, options: unknown) { return manager.sendRequest(method, params, options); }
    getAccount(options: unknown) { return manager.getAccount(options); }
    getAuthMethod(options: unknown) { return manager.getAuthMethod(options); }
    subscribeAuthStatus(listener: any) {
      const retained = listener.dup();
      const callback = (event: any) => { void retained(event); };
      manager.addAuthStatusCallback(callback);
      return new Lease(() => { manager.removeAuthStatusCallback(callback); retained[Symbol.dispose](); });
    }
  }
  class Registry extends RpcTarget {
    subscribe(hostId: string, listener: any) {
      if (hostId !== manager.getHostId()) throw Error(`Unknown execution host: ${hostId}`);
      const retained = listener.dup();
      void retained({ status: 'ready', manager: new ManagerFacade(() => manager) });
      return new Lease(() => retained[Symbol.dispose]());
    }
    openAccount(hostId: string) {
      if (hostId !== manager.getHostId()) throw Error(`Unknown execution host: ${hostId}`);
      return new Account();
    }
  }
  class ApplicationState extends RpcTarget {
    async read(key: string) { return { value: await host('read', key) }; }
    async write(key: string, value: unknown) { await host('write', key, value); return { success: true }; }
  }
  class AppInfo extends RpcTarget {
    get() { return appInfo; }
    getPackagingInfo() { return { isPackaged: false }; }
    getLocaleInfo() { return { ideLocale: 'en-US', systemLocale: 'en-US' }; }
    getSystemInfo() { return { platform: appInfo.platform, arch: appInfo.arch }; }
  }
  class WorkspaceRoots extends RpcTarget {
    read() { return host('workspaceRoots'); }
    // Reads are immutable snapshots and start no cancellable background work.
    cancel() {}
  }
  class ExecutionPaths extends RpcTarget {
    readHomePaths() { return host('homePaths'); }
    async readCodexHome() { return (await host('homePaths')).codexHome; }
    readHomeDirectory() { return host('homeDirectory'); }
  }
  class Startup extends RpcTarget {
    private phases = new Set<string>();
    whenReady() { return null; }
    isSentryEnabled() { return false; }
    reach(phase: string) { this.phases.add(phase); }
  }
  class ExecutionHosts extends RpcTarget {
    getDefaultHost() { return manager.getHostId(); }
  }
  class Root extends RpcTarget {
    get services() { return { appServerManagers: new Registry(), applicationState: new ApplicationState(),
      appInfo: new AppInfo(), startup: new Startup(), workspaceRoots: new WorkspaceRoots(), executionPaths: new ExecutionPaths(),
      requestUserInputAutoResolution: { enabled: false },
      executionHosts: new ExecutionHosts(), windowAppServerEvents: 'all' }; }
  }
  return { root: new Root(), dispose() { for (const cleanup of cleanups) cleanup(); cleanups.clear(); } };
}
