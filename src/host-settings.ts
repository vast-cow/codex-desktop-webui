import { HostState } from './host-state.js';

/** WebUI preferences only; execution configuration remains upstream-owned. */
export class HostSettings {
  constructor(private state: HostState) {}
  private key(key: string) {
    if (typeof key !== 'string' || !key.length) throw Error('Invalid setting key');
    return `renderer-setting:${key}`;
  }
  read(key: string) { return { effective: this.state.readValue(this.key(key)) }; }
  readAll() {
    return { values: Object.fromEntries(Object.entries(this.state.snapshot().values)
      .filter(([key]) => key.startsWith('renderer-setting:'))
      .map(([key, value]) => [key.slice('renderer-setting:'.length), value])) };
  }
  write(key: string, value: unknown) { return this.state.writeValue(this.key(key), value); }
  subscribe(key: string, listener: (value: { effective: unknown }) => void) {
    const storageKey = this.key(key);
    let initial = true, previous: string | undefined;
    return this.state.subscribe(snapshot => {
      const effective = snapshot.values[storageKey];
      const serialized = JSON.stringify(effective);
      if (initial || previous !== serialized) {
        initial = false; previous = serialized; listener({ effective });
      }
    });
  }
}
