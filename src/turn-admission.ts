import type { HostState } from './host-state.js';

/** Browser RPC retries must not create a second turn, even after a host restart. */
export class TurnAdmission {
  constructor(private state: HostState) {}

  async run(threadId: string, options: any, dispatch: () => Promise<unknown>) {
    const messageId = options?.request?.clientUserMessageId;
    if (typeof messageId !== 'string' || !messageId) throw Error('A stable clientUserMessageId is required to submit a turn');
    const key = JSON.stringify([threadId, messageId]);
    let admitted = false;
    await this.state.updateGlobalState('submission-delivery-ledger', value => {
      if (Object.hasOwn(value ?? {}, key)) return value;
      admitted = true;
      return { ...value, [key]: 'reserved' };
    });
    if (!admitted) throw Error('This submission was already admitted; inspect the thread before submitting a new message');
    // Do not clear a failed reservation: RPC failure alone cannot establish that
    // the manager did not dispatch a mutation. A new submission needs a new ID.
    const result = await dispatch();
    await this.state.updateGlobalState('submission-delivery-ledger', value => ({ ...value, [key]: 'delivered-or-unknown' }));
    return result;
  }
}
