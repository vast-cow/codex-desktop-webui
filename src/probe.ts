import { Worker } from 'node:worker_threads';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('.generated');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
// Compiled JavaScript workers keep the runtime independent of TypeScript loaders.
const worker = new Worker(resolve('dist/src/probe-worker.js'), { workerData: { root } });
const timer = setTimeout(() => { void worker.terminate(); console.error('Compatibility worker timed out'); process.exitCode = 1; }, 60000);
worker.on('message', async result => {
  clearTimeout(timer);
  const report = { archiveSha256: manifest.archiveSha256, applicationVersion: manifest.applicationVersion, proofGate: 'not-passed', ...result };
  await mkdir(root, { recursive: true });
  await writeFile(resolve(root, 'probe.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Worker-only candidate:', JSON.stringify(result.candidate.outcome));
  console.log(JSON.stringify(result.outcomes.map(({ id, status, message, managerType }: any) => ({ id, status, message, managerType })), null, 2));
  process.exitCode = result.outcomes.some((outcome: any) => outcome.status === 'blocked') ? 2 : 0;
});
worker.on('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1; });
