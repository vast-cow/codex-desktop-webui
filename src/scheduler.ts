/** Manager scheduling returns independent cancellation functions. */
export class HostScheduler {
  private timers = new Set<NodeJS.Timeout>();
  private disposed = false;
  /** The manager passes this function unbound to passive-thread cleanup. */
  scheduleMicrotask = (callback: () => void): void => {
    if (this.disposed) throw Error('Host scheduler disposed');
    queueMicrotask(() => { if (!this.disposed) callback(); });
  };
  schedule = (callback: () => void, delayMs = 0) => {
    if (this.disposed) throw Error('Host scheduler disposed');
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, delayMs);
    this.timers.add(timer);
    return () => { clearTimeout(timer); this.timers.delete(timer); };
  };
  dispose() { this.disposed = true; for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
}
