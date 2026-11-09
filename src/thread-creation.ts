import type { HostState } from './host-state.js';

/** Reserve before dispatch; an interrupted creation must never be replayed. */
export class ThreadCreation {
  private pending = new Map<string, Promise<any>>();
  constructor(private state: HostState) {}

  run(options: any, dispatch: () => Promise<any>): Promise<any> {
    const id = options?.clientUserMessageId;
    if (typeof id !== 'string' || !id) return Promise.reject(Error('A stable clientUserMessageId is required to create a thread'));
    const existing = this.pending.get(id);
    if (existing) return existing;
    const request = this.create(id, dispatch);
    this.pending.set(id, request);
    const release = () => { if (this.pending.get(id) === request) this.pending.delete(id); };
    void request.then(release, release);
    return request;
  }

  private async create(id: string, dispatch: () => Promise<any>) {
    let admitted = false;
    let previous: any;
    await this.state.updateGlobalState('thread-creation-ledger', value => {
      if (Object.hasOwn(value ?? {}, id)) { previous = value[id]; return value; }
      admitted = true;
      return { ...value, [id]: { status: 'reserved' } };
    });
    if (!admitted) {
      if (previous.status === 'completed') return previous.result;
      throw Error('Thread creation outcome is uncertain; inspect recent threads before creating another');
    }
    const result = await dispatch();
    await this.state.updateGlobalState('thread-creation-ledger', value => ({
      ...value, [id]: { status: 'completed', result }
    }));
    return result;
  }
}
