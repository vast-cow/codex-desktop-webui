/** Serialize browser mutations per thread without merging distinct submissions. */
export class MutationQueue {
  private pending = new Map<string, Promise<unknown>>();
  run<T>(threadId: string, dispatch: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(threadId) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(dispatch);
    this.pending.set(threadId, result);
    const release = () => { if (this.pending.get(threadId) === result) this.pending.delete(threadId); };
    void result.then(release, release);
    return result;
  }
}
