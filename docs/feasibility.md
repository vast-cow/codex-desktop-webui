# Feasibility status

The [2026-11-09 account compatibility verification](verification-2026-11-09.md) passes Plan 1 against the real ChatGPT-backed app server `0.166.0`, using two independent original-renderer browser contexts. The following experiments are historical; their unverified live-server and no-renderer-patch statements are superseded by that record. No later milestone is claimed complete.

## Historical feasibility experiments

The plan 1 implementation now passes both a two-browser protocol regression and a two-browser workflow through the unchanged original renderer against a temporary protocol fixture. The milestone's live-server acceptance gate remains unpassed because the target socket path and server version have not been supplied. No later milestone is claimed complete.

## Reproducing the experiment

Use Node.js 22 and `npm ci`, then run the commands in the README. `assets:prepare` reads the archive without executing vendor code, copies the complete `webview/` tree plus the distribution's third-party notices into `.generated/`, and records all extracted file hashes. It generates a separate HTML entry with a same-origin CSP and a diagnostic bridge loaded ahead of vendor scripts. That bridge forwards the renderer's `connect-app-host` MessagePort through a same-origin WebSocket to the host worker. It implements focus notifications and persistent-atom bootstrap; unsupported native requests fail explicitly. The bridge also supplies initial-route metadata so deep links and refresh reopen the requested thread. The original renderer now opens history and submits through its own composer in Chromium.

The compatibility check compiles TypeScript and starts a dedicated Node worker. The worker verifies the pinned archive identity and the hashes of 19 dependency chunks. It uses Acorn to extract only inert Rspack factory tables, indexes their exports, and invokes the two requested module factories with their dependencies. Neither Electron startup nor renderer startup is evaluated. The VM isolates module globals and limits factory execution time; it is not a security boundary for hostile vendor code.

Exit codes: `0` means the unadapted import probe loaded, `2` means it found a compatibility blocker, and `1` means the harness failed. None means the two-browser proof passed. The report is `.generated/probe.json`; the full extraction inventory is `.generated/manifest.json`. `compatibility/vendor.json` is the reviewable pin, containing archive identity, chunk hashes, module IDs, and candidate factory hashes. Unknown archives and mismatched chunks are rejected.

## Measured results

Input version: `26.1103.32239`. Archive SHA-256: `63106325f6c5fb668e57323ece7c1b29d617877132096e9b856e7606b10c68fe`. The supplied plan identifies build `25471`; this harness has not independently verified that build number.

- 18,926 renderer files extracted with original relative paths, including lazy assets, fonts, styles, and notices.
- The initial static dependency closure of `V7mA` plus `Fkn8` contained 565 module IDs. The probe now also includes the pinned `waIq` record updater. Static closure does not prove all runtime paths or dynamic imports are covered.
- Bundled Cap'n Web `Fkn8` imports successfully without a DOM.
- Unadapted `V7mA.O3` fails during import at `cxUs` in `async/23568.d16db37dce.js`: its named-entity decoder eagerly creates a DOM element.
- A single worker-only factory replacement for `cxUs` lets the manager export load as a function without any DOM shim. The import-only probe does not instantiate the manager. The separate shared-worker harness now does; see the runtime results below.

## Smallest candidate adaptation

`cxUs` exports `s(name)`. It constructs `&name;`, decodes it through an element's `innerHTML`/`textContent`, and returns the decoded text or `false`. The experiment substitutes `entities.decodeHTMLStrict` with the vendor's trailing-semicolon and unchanged-input checks. This is an original worker adapter, not a modification to any extracted file. Browser-versus-library parity for the complete named-entity corpus remains unverified.

The candidate's exact factory target, expected input hash, purpose, and replacement hash are in `compatibility/vendor.json`. Both factory hashes are checked before replacement. No vendor file patches are applied (`patches: []` in the extraction manifest). Broad DOM emulation and vendor rewrites are neither needed for this import nor justified by the evidence so far.

## Remaining gate

The manager has been instantiated with explicit Node adapters and separate browser facades. The remaining acceptance check is the same workflow through the original renderer against the separately managed real server. Protocol-fixture results are not that proof. There is no single-client substitute.

The real upstream Unix socket path has not been supplied. Do not discover a random local socket or start a replacement server. The target server's protocol version, account state, and supported initialization capabilities still require verification. Its documented lifecycle is `initialize` then `initialized`; see the [official app-server documentation](https://learn.chatgpt.com/docs/app-server). Only temporary test servers have been contacted; no calls or mutations have been sent to the separately managed server. An AF_UNIX transport and an explicit read-only `upstream:check` command are now available; see the host contracts.

`assets:check` rehashes the input archive and every extracted renderer file. Unit tests cover ASAR byte preservation, unsafe paths, truncation, factory-only loading, cyclic imports, export forms, and explicit browser-dependency errors. Browser smoke tests and workflow acceptance tests remain pending.

## Shared-worker runtime results

Run `npm run build`, install Chromium with `npx playwright install chromium`, and
run `npm run test:feasibility` after asset preparation. For restricted environments,
set `PLAYWRIGHT_BROWSERS_PATH` to a writable directory for both installation and
testing. Tests use temporary Unix sockets and never contact the real server.

The regression uses two independent Chromium browser contexts (1280px and 390px),
the pinned bundled Cap'n Web factory, the browser bridge, the host WebSocket, and
one central `V7mA.O3` worker instance. It verifies:

- One initialization and upstream connection for both browsers.
- Nonempty history loaded by the vendor manager, visible to both facades.
- Vendor resume and turn submission, with one `turn/start` upstream frame.
- Stream notifications delivered to both browsers.
- Competing approval responses producing exactly one upstream response.
- Closing one browser while the other continues receiving stream updates.
- A new browser lease recovering the accumulated history without resubmission.

The generated `.generated/feasibility.json` records the protocol workflow;
`.generated/renderer-feasibility.json` records the original-renderer workflow.
Both explicitly retain an unpassed live-server gate. The
protocol test document is test-only; it is not a replacement product UI.

The host uses `CODEX_SOCKET_PATH`, optional `CODEX_UPGRADE_PATH`, and
`WEBUI_DATA_DIR`. With no socket configured it serves assets and explicit manager
diagnostics; it never chooses a socket or launches a server. See
`/manager-status` for current worker availability. A disconnected upstream closes
browser leases and requires host restart; automatic upstream reconciliation is
not implemented. No mutations are replayed.

## Original renderer workflow

The second regression serves the original entry and lazy chunks without changing
any renderer factory. Two independent Chromium contexts open a nonempty history
through the original UI, submit through its composer, see the same stream, resolve
an approval through the original Allow once button, and recover after one browser
reconnects. One context uses a 390px viewport. Screenshots are written to
`.generated/renderer-desktop.png` and `.generated/renderer-narrow.png`.

These tests use a simulated API-key account and a declared fixture protocol
version. They do not verify a live ChatGPT-backed account or the capabilities of
the user's server. Optional cloud services remain unavailable. Rejected desktop
messages are listed in a collapsed diagnostics panel; automatic approval/input
resolution is disabled, and no successful native action is fabricated.

The startup loader was traced to the renderer's gateway-OAuth readiness gate,
which waits for non-null server-version metadata. `CODEX_SERVER_VERSION` supplies
the operator-asserted version of the configured target. It must be obtained from
that target's administrator or deployment metadata; no version is inferred from
`initialize.userAgent`, and no placeholder version is substituted. With no version
configured, the browser explains what is missing instead of silently spinning.
The [documented initialization response](https://learn.chatgpt.com/docs/app-server#initialization)
does not promise a semantic server-version field.

`CODEX_WORKSPACE_ROOT` chooses an existing host directory (default: the host's
working directory). The worker validates it and exposes it through the observed
workspace-roots contract. Home paths, system information, account capabilities,
connection-state notifications, persistent drafts, and renderer startup phases are
also supplied without Electron startup.

Node.js 22 lacks the disposal stack used by the bundled message coordinator. A
self-contained adapter creates it inside the vendor VM with LIFO cleanup, transfer
of ownership, and suppressed-error handling. This is an original runtime adapter,
not a vendor rewrite. Queue readiness and send/start locks are host-owned; state
records are normalized into the vendor VM before callbacks or RPC serialization.
Structured draft updates reuse the pinned pure `waIq.m` module so conditional
updates retain the renderer's conflict semantics.

## Measured patch requirements and live gate

The existing `cxUs` worker factory replacement remains the only vendor adaptation.
No renderer rewrite or DOM emulation is required for the tested workflows.
`compatibility/vendor.json` additionally records the reused record-update module;
all of its input chunks were already hash-pinned. The original archive and all
18,926 extracted renderer files remain unchanged.

The remaining work for the plan 1 acceptance gate is to repeat the workflow against
the separately managed target using its explicit socket path and actual version.
That may reveal target-specific protocol or account differences requiring further
adapters. The fixture results are architectural evidence, not a claim that those
unobserved differences are already handled. The host never starts or reconfigures
the target server.
