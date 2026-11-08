import { Upstream } from './upstream.js';

// Inspect only the explicitly configured server. Never discover or manage it.
const socketPath = process.env.CODEX_SOCKET_PATH;
if (!socketPath) {
  console.error('Set CODEX_SOCKET_PATH to the existing app server Unix socket. No server was contacted.');
  process.exitCode = 1;
} else {
  const upstream = new Upstream({ socketPath, upgradePath: process.env.CODEX_UPGRADE_PATH });
  try {
    await upstream.connect();
    const account = await upstream.sendRequest('account/read', { refreshToken: false });
    if (!account || typeof account !== 'object' || !('account' in account)) throw Error('Incompatible account/read response');
    // Account identity and credentials must not appear in the probe output.
    console.log(JSON.stringify({ connected: true, initialized: true, accountType: account.account?.type ?? null, proofGate: 'not-passed' }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally { upstream.close(); }
}
