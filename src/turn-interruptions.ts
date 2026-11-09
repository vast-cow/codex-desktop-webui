/** Share stop delivery, including failures whose upstream outcome is uncertain.
 * Never evict an entry and silently make an old mutation eligible for replay.
 */
export class TurnInterruptions {
  private requests = new Map<string, Promise<any>>();
  constructor(private limit = 4096) {}

  run(params: any, dispatch: () => Promise<any>): Promise<any> {
    if (typeof params?.threadId !== 'string' || !params.threadId || typeof params?.turnId !== 'string' || !params.turnId) {
      return Promise.reject(Error('Interruption requires threadId and turnId'));
    }
    const key = JSON.stringify([params.threadId, params.turnId]);
    const existing = this.requests.get(key);
    if (existing) return existing;
    if (this.requests.size >= this.limit) return Promise.reject(Error('Interruption delivery ledger is full; inspect upstream state'));
    const result = Promise.resolve().then(dispatch);
    this.requests.set(key, result);
    return result;
  }
}
