/** Manager scheduling returns independent cancellation functions. */
export class HostScheduler {
  private timers = new Set<NodeJS.Timeout>();
  private disposed = false;
  schedule = (callback: () => void, delayMs = 0) => {
    if (this.disposed) throw Error('Host scheduler disposed');
    const timer = setTimeout(() => { this.timers.delete(timer); callback(); }, delayMs);
    this.timers.add(timer);
    return () => { clearTimeout(timer); this.timers.delete(timer); };
  };
  dispose() { this.disposed = true; for (const timer of this.timers) clearTimeout(timer); this.timers.clear(); }
}
