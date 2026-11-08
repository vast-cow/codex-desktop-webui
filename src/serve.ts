import { resolve } from 'node:path';
import { createAssetHost } from './asset-host.js';
const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT must be between 1 and 65535');
const host = process.env.HOST ?? '0.0.0.0';
const server = await createAssetHost(resolve('.generated'));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`Feasibility assets listening on ${host}:${port}; renderer host services are not implemented.`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
