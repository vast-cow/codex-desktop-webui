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
  }
  class Startup extends RpcTarget {
    whenReady() { return null; }
    isSentryEnabled() { return false; }
  }
  class ExecutionHosts extends RpcTarget {
    getDefaultHost() { return manager.getHostId(); }
  }
  class Root extends RpcTarget {
    get services() { return { appServerManagers: new Registry(), applicationState: new ApplicationState(),
      appInfo: new AppInfo(), startup: new Startup(), executionHosts: new ExecutionHosts(), windowAppServerEvents: 'all' }; }
  }
  return { root: new Root(), dispose() { for (const cleanup of cleanups) cleanup(); cleanups.clear(); } };
}
