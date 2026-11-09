# Standalone account compatibility

The worker owns one `codexAccount` service over the existing upstream connection.
`read()` returns a snapshot; `subscribe(callback)` immediately queues the current
snapshot followed by ordered updates and returns a disposable browser lease.
Disposing one lease never closes the upstream connection. Revisions increase on
all state transitions; generation checks discard replies from superseded reads
or a disconnected transport. Upstream `account/updated` and
`account/login/completed` notifications invalidate and refresh the snapshot.

Sources are `account/read` with `refreshToken: false` and `getAuthStatus` with
`includeToken: false, refreshToken: false`. No authentication files are read.
Snapshots expose `status`, `authMethod`, `requiresOpenaiAuth`, `account`, and
`revision`. Account fields are limited to `type`, `planType`, and `workspaceName`;
email, IDs, token fields, and unexpected response fields are excluded.
`acquired` describes successful acquisition, not model entitlement or token
validity. Other states are `acquiring`, `authentication-required`,
`connection-unavailable` (including request timeouts), and
`protocol-incompatible`. Acquisition errors never expose raw upstream messages.
`/manager-status` exposes only the acquisition status alongside worker readiness;
`ready` continues to describe the connection, and the proof gate stays separate.

## Renderer investigation

`YitN` queries `accountInfo.readAccountInfo()` and waits on `accessInputs`.
`cE1j` calls it for ChatGPT authentication, then checks desktop IDs and
`hasChatGptToken`. It also loads ChatGPT cloud account inventories and publishes
cloud identity state. The app server provides none of these desktop identities.
The missing HTTP fetch service also affects unrelated telemetry; its failure
alone cannot diagnose account readiness.

The generation-time patch adapts `cE1j` and the local access selector in `eFn4` using a standalone provider
subscribing to `codexAccount`. It preserves the real authentication method and
leaves desktop identities absent. ChatGPT cloud inventories and Pages do not
supply local Codex authentication. The local selector permits an attempt when acquisition succeeds; the app server
remains authoritative for model access and request errors. Cloud access atoms
remain disabled. Root navigation uses the existing `/hotkey-window/new-thread`
Codex route; conversation URLs preserve their routes. The account boundary receives the real
authentication method to release renderer initialization.

`compatibility/renderer-auth.json` pins the original chunk and factory and records
the patch purpose. Preparation preserves all extracted files and writes the
replacement to `.generated/patched/`. The extraction manifest records input,
replacement, and output hashes. Asset delivery checks the patched bytes and
`assets:check` verifies both original and patched files. Unknown inputs fail
closed. The original `chatgpt/` archive remains unchanged.

## Live verification procedure

Use the existing server; never launch, restart, reconfigure, or log it out.
For this environment the operator supplied version `0.166.0` and URL
`ws://127.0.0.1:4500/`. The previously supplied Unix socket was absent.

```sh
CODEX_SERVER_URL=ws://127.0.0.1:4500/ npm run upstream:check
npm run assets:prepare
npm run build
npm test
npm run assets:check
PLAYWRIGHT_BROWSERS_PATH=/tmp/webui-playwright npm run test:feasibility
CODEX_SERVER_URL=ws://127.0.0.1:4500/ CODEX_SERVER_VERSION=0.166.0 \
CODEX_WORKSPACE_ROOT=/tmp/webui-live-workspace \
WEBUI_DATA_DIR=/tmp/webui-live-state npm start
```

Create the dedicated workspace before starting the WebUI. Open `/` in independent
1280px and 390px browser contexts, create a new conversation, and record its URL.
Load that URL in both contexts and reload it. Submit a harmless test instruction
confined to the dedicated directory, and observe streamed output in both.
Trigger a real command approval there, race conflicting responses from the two
contexts, and count exactly one upstream approval response. During another stream,
disconnect one context, verify the other continues, and reopen the conversation.
Record only method/event counts, timestamps, renderer/patch hashes, and outcomes;
exclude conversation text and account identity. Check one initialization/connection,
no duplicate turn submissions, and no duplicate approvals. If the server cannot
produce an approval, that criterion remains unverified. Fixture success never
substitutes for live verification. Restart only the WebUI to apply corrections.

See [the verification record](verification-2026-11-09.md) for measured results and the live protocol blocker.

## Automated live procedure

After asset preparation and browser installation, run:

```sh
CODEX_SERVER_URL=ws://127.0.0.1:4500/ CODEX_SERVER_VERSION=0.166.0 \
PLAYWRIGHT_BROWSERS_PATH=/tmp/webui-playwright npm run verify:live
```

This explicitly mutating test creates a dedicated ignored workspace, temporary
WebUI state, and a new conversation under `.generated/live-runs/`. A preparatory
connection seeds history and closes before the host starts. The host then owns
one central connection for both original browser contexts. The test opens `/`,
loads history in both contexts, requests a harmless Python write confined to the
test directory with a per-turn `untrusted` approval policy, sends conflicting accept/decline RPC decisions from the two browser facades
while the approval is visible in both original interfaces, and checks exactly one response. It sends a separate streamed turn
through the original composer, disconnects one page after output appears in both,
checks further deltas at the remaining page, and reloads history in a fresh page.
Only the WebUI child process is stopped. The app server is never managed.

Reports contain timestamps, asset/patch identities, fixed counters and outcomes;
they exclude account identity and conversation content. The command returns a
nonzero exit code for failed or unverified criteria, including an unavailable
real approval. The current host's `proofGate` field does not certify experiments;
use the dated verification report for the tested target and asset identities.

Effective config reads materialize absent options as `null`. These placeholders
are omitted when making TOML session flags; explicit values, including empty
arrays, false, zero, and configured environment policies, are preserved. The
host supplies the disabled history-timeline setting required by server version
`0.166.0`; this does not implement the later timeline feature.
