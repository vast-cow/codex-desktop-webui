import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWire, decodeWire } from '../src/wire.js';

test('preserves RPC structured-clone values that plain JSON loses', () => {
  const frame = ['push', { absent: undefined, bytes: new Uint8Array([0, 255]),
    numbers: [NaN, Infinity, -Infinity, -0], bigint: 2n ** 64n,
    nested: [undefined, null, false, 'undefined'], tags: ['bytes', [0]] }];
  assert.deepEqual(decodeWire(encodeWire(frame)), frame);
});
test('object keys cannot change prototypes and malformed frames fail explicitly', () => {
  const value = JSON.parse('{"__proto__":{"polluted":true}}');
  const decoded: any = decodeWire(encodeWire(value));
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.hasOwn(decoded, '__proto__'), true);
  assert.equal(({} as any).polluted, undefined);
  for (const input of ['null', '{}', '["unknown"]', '["number","garbage"]', '["bytes",[256]]', '["object",[[null,[]]]]']) assert.throws(() => decodeWire(input));
  assert.throws(() => encodeWire(() => {}), /Unsupported/);
});
