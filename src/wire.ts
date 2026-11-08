/** JSON transport for the structured-clone subset emitted by bundled Cap'n Web. */
export function encodeWire(value: unknown): string {
  function encode(input: any): any {
    if (input === undefined) return ['undefined'];
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return ['value', input];
    if (typeof input === 'number') return ['number', Object.is(input, -0) ? '-0' : String(input)];
    if (typeof input === 'bigint') return ['bigint', String(input)];
    if (input instanceof Uint8Array) return ['bytes', Array.from(input)];
    if (Array.isArray(input)) return ['array', input.map(encode)];
    if (typeof input === 'object' && Object.getPrototypeOf(input) === Object.prototype) return ['object', Object.entries(input).map(([key, value]) => [key, encode(value)])];
    throw Error('Unsupported browser RPC wire value');
  }
  return JSON.stringify(encode(value));
}
export function decodeWire(text: string): unknown {
  function decode(input: any): any {
    if (!Array.isArray(input)) throw Error('Invalid browser RPC wire value');
    const [kind, value] = input;
    switch (kind) {
      case 'undefined': return undefined;
      case 'value': if (value === null || typeof value === 'string' || typeof value === 'boolean') return value; break;
      case 'number': if (typeof value === 'string' && (value === '-0' || String(Number(value)) === value)) return Number(value); break;
      case 'bigint': if (typeof value === 'string') return BigInt(value); break;
      case 'bytes': if (Array.isArray(value) && value.every(v => Number.isInteger(v) && v >= 0 && v <= 255)) return new Uint8Array(value); break;
      case 'array': if (Array.isArray(value)) return value.map(decode); break;
      case 'object': if (Array.isArray(value) && value.every(entry => Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string')) return Object.fromEntries(value.map(([key, item]) => [key, decode(item)])); break;
    }
    throw Error('Invalid browser RPC wire value');
  }
  return decode(JSON.parse(text));
}
