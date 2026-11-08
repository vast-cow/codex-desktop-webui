# Browser feasibility host

Run `npm run assets:prepare`, then `npm run dev`. For compiled execution run
`npm run build` followed by `npm start`. Both serve the separate generated entry
and the full renderer asset tree. This is a feasibility host: it displays diagnostics
because renderer services and the central manager are not wired together yet.
Opening two tabs does not satisfy the plan 1 workflow gate.

The listener defaults to `0.0.0.0:3000`. Use `HOST` and `PORT` to change it.
Access it directly using `http://HOST_MACHINE_IP:3000` over your LAN or VPN.
There is no application authentication. Every eventual browser facade will refer
to the same host account and filesystem. Restrict reachability through your
existing network configuration as needed.

For an existing Tailscale HTTPS endpoint or reverse proxy, forward the origin's
root path to `http://127.0.0.1:3000`. Assets and bridge URLs are relative to the
serving origin. Subpath hosting is not supported. This harness does not configure
Tailscale or introduce a login system. Clipboard APIs may be unavailable on remote
plain HTTP; browser equivalents still require implementation and testing.

`GET /healthz` reports `proofGate: "not-passed"` and unavailable renderer services.
Missing chunks return 404. Changed or unavailable prepared files return 503.
The host verifies the entry and bridge before listening and verifies every served
asset against the preparation manifest. Re-run preparation after building a changed
bridge. SPA document routes fall back to the generated entry; asset requests never
receive an HTML fallback. Browser RPC upgrades are not implemented yet.

# Existing app server

Set an explicit `CODEX_SOCKET_PATH` and optionally `CODEX_UPGRADE_PATH` (default
`/rpc`), then run `npm run upstream:check`. The probe initializes a connection and
reads account state without submitting a turn. It prints only the account type,
not account identity or credentials. No server is discovered, spawned, restarted,
or reconfigured. This command is separate from the asset host until manager
integration is implemented.

An absent socket reports ENOENT; inaccessible sockets report operating-system
permission errors. An incorrect upgrade path reports a failed WebSocket handshake.
An incompatible initialize response fails explicitly. Check the socket path and
protocol of your separately managed server. Do not replace it with a test fixture
to claim completion of the live proof gate.
