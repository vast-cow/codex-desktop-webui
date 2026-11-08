import test from 'node:test';
import assert from 'node:assert/strict';
import { managerContract } from '../src/manager-contract.js';

test('extracts required and defaulted services without executing vendor code', () => {
  const contract = managerContract(`function(m,e,r){r.d(e,{O3:()=>Manager});throw Error('startup');class Manager {constructor(options){const {hostId:h,transport,settings={},sendApprovalResponse=transport}=options;}}}`);
  assert.deepEqual(contract.services, [
    { name: 'hostId', defaulted: false }, { name: 'transport', defaulted: false },
    { name: 'settings', defaulted: true }, { name: 'sendApprovalResponse', defaulted: true }
  ]);
});
test('rejects changed export and constructor shapes instead of silently guessing', () => {
  assert.throws(() => managerContract('function(){}'), /Cannot locate/);
  assert.throws(() => managerContract('function(m,e,r){r.d(e,{O3:()=>M});class M{constructor({x}){}}}'), /Unsupported/);
});
