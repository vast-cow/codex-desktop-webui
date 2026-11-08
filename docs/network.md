# Browser feasibility host

Run `npm run assets:prepare`, then `npm run dev`. For compiled execution run
`npm run build` followed by `npm start`. Both serve the separate generated entry
and the full renderer asset tree. This is a feasibility host: it displays diagnostics
for missing configuration and unsupported native integrations. The central manager and original-renderer workflow are fixture-tested; the live gate is not passed.
Opening two tabs does not satisfy the plan 1 workflow gate.

The listener defaults to `0.0.0.0:3000`. Use `HOST` and `PORT` to change it.
Access it directly using `http://HOST_MACHINE_IP:3000` over your LAN or VPN.
There is no application authentication. Every browser facade refers
to the same host account and filesystem. Restrict reachability through your
existing network configuration as needed.

For an existing Tailscale HTTPS endpoint or reverse proxy, forward the origin's
root path to `http://127.0.0.1:3000`. Assets and bridge URLs are relative to the
serving origin. Subpath hosting is not supported. This harness does not configure
Tailscale or introduce a login system. Clipboard APIs may be unavailable on remote
plain HTTP; browser equivalents still require implementation and testing.

`GET /healthz` and `/manager-status` report worker availability, limited renderer
services, missing version metadata, and `proofGate: "not-passed"`.
Missing chunks return 404. Changed or unavailable prepared files return 503.
The host verifies the entry and bridge before listening and verifies every served
asset against the preparation manifest. Re-run preparation after building a changed
bridge. SPA document routes fall back to the generated entry; asset requests never
receive an HTML fallback. Browser Cap'n Web RPC uses the same origin at `/app-host`; `/manager-status` reports current worker availability separately from the unpassed workflow gate.

# Existing app server

Set an explicit `CODEX_SOCKET_PATH` and optionally `CODEX_UPGRADE_PATH` (default
`/rpc`), then run `npm run upstream:check`. The probe initializes a connection and
reads account state without submitting a turn. It prints only the account type,
not account identity or credentials. No server is discovered, spawned, restarted,
or reconfigured. The asset host also reads these variables to start one central worker. Set
`WEBUI_DATA_DIR` to choose a WebUI-owned directory separate from the desktop
application's files. If the socket is absent or initialization fails, the host
serves diagnostics and rejects RPC upgrades. Set `CODEX_SERVER_VERSION` to the actual semantic version of that target server;
the initialization user-agent is not used as a server version. Without this setting,
the browser reports missing metadata. `CODEX_WORKSPACE_ROOT` selects an existing
host directory; it defaults to the host working directory. `PORT=0` requests an
ephemeral listener for testing. After an upstream disconnect, restart
the host; it does not automatically reconcile or replay mutations.

An absent socket reports ENOENT; inaccessible sockets report operating-system
permission errors. An incorrect upgrade path reports a failed WebSocket handshake.
An incompatible initialize response fails explicitly. Check the socket path and
protocol of your separately managed server. Do not replace it with a test fixture
to claim completion of the live proof gate.

## Shared-manager feasibility regression

After asset preparation, install Chromium and run the browser regression:

```sh
npx playwright install chromium
npm run test:feasibility
```

When the browser cache must live in a writable location, set the same
`PLAYWRIGHT_BROWSERS_PATH` for both commands. This starts a temporary protocol
fixture and temporary WebUI state. It never contacts the real server. Its
protocol test document exercises the bundled RPC and manager with two browser
contexts. A separate regression uses the unchanged original renderer, including
its composer and approval UI, at desktop and narrow widths. Both are fixture
tests and do not pass the live proof gate.
