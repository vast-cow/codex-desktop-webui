import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { patchRenderer } from '../src/renderer-patch.js';
import { sha256 } from '../src/asar.js';
test('renderer patch is deterministic, rejects unknown input, and preserves source', async () => {
  const pin = JSON.parse(await readFile('compatibility/renderer-auth.json', 'utf8'));
  const source = await readFile(`.generated/${pin.path}`, 'utf8');
  const a = patchRenderer(source, pin), b = patchRenderer(source, pin);
  assert.deepEqual(a, b); assert.equal(sha256(source), pin.inputSha256);
  assert.throws(() => patchRenderer(source + ' ', pin), /input mismatch/);
  assert.throws(() => patchRenderer(source, { ...pin, factorySha256: 'unknown' }), /factory mismatch/);
  assert.equal(sha256(a.output), a.record.outputSha256);
});
