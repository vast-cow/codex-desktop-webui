import test from 'node:test';
import assert from 'node:assert/strict';
import { factories, ModuleLoader } from '../src/loader.js';

function loader(source: string) {
  return new ModuleLoader(new Map(factories(source, 'fixture.js').map(factory => [factory.id, factory])));
}
test('extracts factories without executing renderer startup or other modules', () => {
  const instance = loader(`export const __webpack_modules__={A(m,e,r){r.d(e,{answer:()=>42});},B(){throw Error('unrelated');}};throw Error('renderer startup');`);
  assert.equal(instance.require('A').answer, 42);
  assert.deepEqual(instance.loaded, ['A']);
});
test('supports cycles, CommonJS exports, and both Rspack export forms', () => {
  const instance = loader(`export const __webpack_modules__={A(m,e,r){e.name='A';e.b=r('B');},B(m,e,r){r.d(e,{a:()=>r('A').name},{constant:7});}};`);
  assert.equal(instance.require('A').b.a, 'A');
  assert.equal(instance.require('B').constant, 7);
  assert.deepEqual(instance.loaded, ['A', 'B']);
});
test('reports browser-only dependencies instead of emulating DOM', () => {
  const instance = loader(`export const __webpack_modules__={A(m,e,r){r('B');},B(){document.createElement('div');}};`);
  assert.throws(() => instance.require('A'), /document is not defined/);
  assert.deepEqual(instance.loaded, ['A', 'B']);
});
test('records dependency closure and missing module chain', () => {
  const source = `export const __webpack_modules__={A(m,e,r){r('missing');}};`;
  assert.deepEqual(factories(source, 'fixture.js')[0].dependencies, ['missing']);
  assert.throws(() => loader(source).require('A'), /A -> missing/);
});
