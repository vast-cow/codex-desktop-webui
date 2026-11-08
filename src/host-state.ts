import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

type Values = Record<string, unknown>;
interface Snapshot { revision: number; values: Values }
function clone<T>(value: T): T { return structuredClone(value); }
function validate(value: unknown): asserts value is Snapshot {
  const s = value as Snapshot;
  if (!s || !Number.isSafeInteger(s.revision) || s.revision < 0 || !s.values || typeof s.values !== 'object' || Array.isArray(s.values)) throw Error('Invalid WebUI state file');
}

/** One store owned by the host, separate from all desktop application files. */
export class HostState {
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private constructor(private path: string, private state: Snapshot) {}
  static async open(dataDirectory: string) {
    const path = resolve(dataDirectory, 'webui-state.json');
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    let state: Snapshot = { revision: 0, values: {} };
    try { state = JSON.parse(await readFile(path, 'utf8')); validate(state); }
    catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    return new HostState(path, state);
  }
  snapshot(): Snapshot { return clone(this.state); }
  readValue(key: string): unknown { return Object.hasOwn(this.state.values, key) ? clone(this.state.values[key]) : undefined; }
  async read(key: string) { return { value: this.readValue(key) }; }
  async write(key: string, value: unknown) { await this.writeValue(key, value); return { success: true }; }
  async readGlobalState(key: string) { return this.readValue(key); }
  writeValue(key: string, value: unknown) { const captured = clone(value); return this.updateGlobalState(key, () => captured); }
  updateGlobalState(key: string, update: (value: any) => unknown) {
    const result = this.tail.then(async () => {
      const value = update(this.readValue(key));
      const next = this.snapshot(); next.revision++;
      // Values use JSON serialization semantics; undefined deletes a key.
      if (value === undefined) delete next.values[key];
      else {
        const serialized = JSON.stringify(value);
        if (serialized === undefined) throw Error('State value must be JSON serializable');
        Object.defineProperty(next.values, key, { value: JSON.parse(serialized), enumerable: true, writable: true, configurable: true });
      }
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temp, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(next) + '\n'); await file.sync(); }
        finally { await file.close(); }
        await rename(temp, this.path);
      } finally { await unlink(temp).catch((error: any) => { if (error.code !== 'ENOENT') throw error; }); }
      this.state = next;
      for (const listener of [...this.listeners]) {
        // A disconnected browser cannot prevent state publication to other clients.
        try { listener(this.snapshot()); } catch { this.listeners.delete(listener); }
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }
  /** Subscribe synchronously: the initial snapshot always precedes later commits. */
  subscribe(listener: (snapshot: Snapshot) => void) {
    this.listeners.add(listener);
    try { listener(this.snapshot()); }
    catch (error) { this.listeners.delete(listener); throw error; }
    return () => { this.listeners.delete(listener); };
  }
  async flush() { await this.tail; }
}
