export type AccountStatus = 'acquiring' | 'acquired' | 'authentication-required' | 'connection-unavailable' | 'protocol-incompatible';
export interface AccountSnapshot {
  status: AccountStatus;
  authMethod: string | null;
  requiresOpenaiAuth: boolean | null;
  account: { type: string; planType?: string; workspaceName?: string } | null;
  revision: number;
}
interface Source { isReady: boolean; sendRequest(method: string, params: unknown): Promise<any> }

/** Host-owned, token-free state. Revisions fence late replies after invalidation. */
export class CodexAccount {
  private snapshot: AccountSnapshot = { status: 'acquiring', authMethod: null, requiresOpenaiAuth: null, account: null, revision: 0 };
  private generation = 0;
  private listeners = new Set<(snapshot: AccountSnapshot) => void>();
  constructor(private source: Source) {}
  read(): AccountSnapshot { return structuredClone(this.snapshot); }
  subscribe(listener: (snapshot: AccountSnapshot) => void) {
    this.listeners.add(listener);
    listener(this.read());
    return () => { this.listeners.delete(listener); };
  }
  private publish(value: Omit<AccountSnapshot, 'revision'>) {
    this.snapshot = { ...value, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) { try { listener(this.read()); } catch { /* A failed lease cannot interrupt other subscribers. */ } }
  }
  disconnect() {
    ++this.generation;
    this.publish({ status: 'connection-unavailable', authMethod: null, requiresOpenaiAuth: null, account: null });
  }
  async refresh() {
    if (!this.source.isReady) { this.disconnect(); return; }
    const generation = ++this.generation;
    this.publish({ status: 'acquiring', authMethod: null, requiresOpenaiAuth: null, account: null });
    try {
      const [response, auth] = await Promise.all([
        this.source.sendRequest('account/read', { refreshToken: false }),
        this.source.sendRequest('getAuthStatus', { includeToken: false, refreshToken: false }),
      ]);
      if (generation !== this.generation) return;
      if (!this.source.isReady) { this.disconnect(); return; }
      const methods = ['chatgpt', 'chatgptAuthTokens', 'apikey'];
      if (!response || typeof response.requiresOpenaiAuth !== 'boolean' || !auth ||
        !(auth.authMethod === null || methods.includes(auth.authMethod)) ||
        !(response.account === null || response.account && ['chatgpt', 'apiKey'].includes(response.account.type))) throw Error('Invalid account protocol');
      const account = response.account === null ? null : {
        type: response.account.type,
        ...(typeof response.account.planType === 'string' ? { planType: response.account.planType } : {}),
        ...(typeof response.account.workspaceName === 'string' ? { workspaceName: response.account.workspaceName } : {}),
      };
      this.publish({ status: response.requiresOpenaiAuth && (!account || !auth.authMethod) ? 'authentication-required' : 'acquired',
        account, authMethod: auth.authMethod, requiresOpenaiAuth: response.requiresOpenaiAuth });
    } catch (error) {
      if (generation !== this.generation) return;
      // Never expose upstream error text: it can contain account details or tokens.
      this.publish({ status: !this.source.isReady || /timed out/i.test(String(error)) ? 'connection-unavailable' : 'protocol-incompatible',
        account: null, authMethod: null, requiresOpenaiAuth: null });
    }
  }
}
