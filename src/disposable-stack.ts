/** Self-contained factory, also evaluated inside the vendor VM on Node.js 22. */
export function createDisposableStack() {
  class SuppressedDisposalError extends Error {
    readonly name = 'SuppressedError';
    constructor(readonly error: unknown, readonly suppressed: unknown) { super('An error was suppressed during disposal'); }
  }
  return class DisposableStack {
    private callbacks: (() => void)[] = [];
    private isDisposed = false;
    get disposed() { return this.isDisposed; }
    private assertActive() { if (this.isDisposed) throw new ReferenceError('DisposableStack is disposed'); }
    use<T extends { [Symbol.dispose](): void } | null | undefined>(value: T): T {
      this.assertActive();
      if (value != null) {
        const dispose = value[Symbol.dispose];
        if (typeof dispose !== 'function') throw new TypeError('Resource has no Symbol.dispose method');
        this.callbacks.push(() => dispose.call(value));
      }
      return value;
    }
    adopt<T>(value: T, callback: (value: T) => void): T {
      this.assertActive(); if (typeof callback !== 'function') throw new TypeError('Disposal callback must be callable');
      this.callbacks.push(() => callback(value)); return value;
    }
    defer(callback: () => void) { this.assertActive(); if (typeof callback !== 'function') throw new TypeError('Disposal callback must be callable'); this.callbacks.push(callback); }
    move(): DisposableStack {
      this.assertActive(); const target = new DisposableStack(); target.callbacks = this.callbacks;
      this.callbacks = []; this.isDisposed = true; return target;
    }
    dispose() {
      if (this.isDisposed) return;
      this.isDisposed = true;
      let failed = false, failure: unknown;
      while (this.callbacks.length) {
        try { this.callbacks.pop()!(); }
        catch (error) { failure = failed ? new SuppressedDisposalError(error, failure) : error; failed = true; }
      }
      if (failed) throw failure;
    }
    [Symbol.dispose]() { this.dispose(); }
  };
}
