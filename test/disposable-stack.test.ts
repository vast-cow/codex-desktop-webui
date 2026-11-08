import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisposableStack } from '../src/disposable-stack.js';

test('manager disposal stacks release resources once in reverse order and retain method receivers', () => {
  const Stack = createDisposableStack(), stack = new Stack(), calls: string[] = [];
  const resource = { name: 'resource', [Symbol.dispose]() { calls.push(this.name); } };
  assert.equal(stack.use(resource), resource);
  stack.use(null);
  stack.adopt('adopted', value => calls.push(value));
  stack.defer(() => calls.push('deferred'));
  const moved = stack.move(); assert.equal(stack.disposed, true);
  stack.dispose(); assert.deepEqual(calls, []);
  moved[Symbol.dispose](); moved.dispose();
  assert.deepEqual(calls, ['deferred', 'adopted', 'resource']);
  assert.throws(() => moved.defer(() => {}), ReferenceError);
});
test('failing cleanup still releases every resource and preserves suppressed errors', () => {
  const Stack = createDisposableStack(), stack = new Stack();
  const first = Error('first'), second = Error('second'); let released = false;
  stack.defer(() => { released = true; });
  stack.defer(() => { throw second; }); stack.defer(() => { throw first; });
  assert.throws(() => stack.dispose(), (error: any) => error.name === 'SuppressedError' && error.error === second && error.suppressed === first);
  assert.equal(released, true); assert.equal(stack.disposed, true);
});
