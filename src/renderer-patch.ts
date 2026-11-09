import { factories } from './loader.js';
import { sha256 } from './asar.js';
import { standaloneAuth } from './standalone-auth.js';
export function patchRenderer(source: string, pin: any) {
  if (sha256(source) !== pin.inputSha256) throw Error('Renderer patch input mismatch');
  const factory = factories(source, pin.path).find(item => item.id === pin.module);
  if (!factory || sha256(factory.source) !== pin.factorySha256) throw Error('Renderer factory mismatch');
  const replacement = `${pin.module}:function(...args){const __name=(value)=>value;return (${standaloneAuth.toString()})(...args);}`;
  let output = source.slice(0, factory.start) + replacement + source.slice(factory.end);
  const access = factories(output, pin.path).find(item => item.id === pin.accessModule.id);
  if (!access || sha256(access.source) !== pin.accessModule.factorySha256) throw Error('Renderer access factory mismatch');
  const original = output.slice(access.start, access.end);
  const adapted = original
    .replace('ml:()=>I,', 'standaloneAccount$:()=>hostAccount,ml:()=>I,')
    .replace('A=(0,r.un)', 'hostAccount=(0,r.vP)(l.u,()=>null),A=(0,r.un)')
    .replace('(0,f.on)(e(f.M9))??e(A).local', '(function(s){return s==null||s.status==="acquiring"?{status:"loading"}:s.status==="acquired"?{status:"allowed",accountId:null}:s.status==="authentication-required"?{status:"denied",reason:"authentication-required"}:{status:"error",source:"account-info"}})(e(hostAccount))');
  if (adapted === original || !adapted.includes('standaloneAccount$') || !adapted.includes('hostAccount=')) throw Error('Renderer access target mismatch');
  output = output.slice(0, access.start) + adapted + output.slice(access.end);
  return { output, record: { ...pin, outputSha256: sha256(output), replacementSha256: sha256(replacement), accessOutputSha256: sha256(adapted), generatedPath: `patched/${pin.path}` } };
}
