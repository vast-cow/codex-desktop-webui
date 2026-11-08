# Feasibility status

The first milestone remains incomplete: the shared manager now executes successfully in a Node worker and passes a two-browser protocol-fixture regression, but the original renderer workflow and the live-server proof are not passed. No later milestone is claimed complete.

## Reproducing the experiment

Use Node.js 22 and `npm ci`, then run the commands in the README. `assets:prepare` reads the archive without executing vendor code, copies the complete `webview/` tree plus the distribution's third-party notices into `.generated/`, and records all extracted file hashes. It generates a separate HTML entry with a same-origin CSP and a diagnostic bridge loaded ahead of vendor scripts. That bridge forwards the renderer's `connect-app-host` MessagePort through a same-origin WebSocket to the host worker. It implements focus notifications and persistent-atom bootstrap; unsupported native requests fail explicitly. The original renderer still shows a startup loader in the browser smoke experiment.

The compatibility check compiles TypeScript and starts a dedicated Node worker. The worker verifies the pinned archive identity and the hashes of 19 dependency chunks. It uses Acorn to extract only inert Rspack factory tables, indexes their exports, and invokes the two requested module factories with their dependencies. Neither Electron startup nor renderer startup is evaluated. The VM isolates module globals and limits factory execution time; it is not a security boundary for hostile vendor code.

Exit codes: `0` means the unadapted import probe loaded, `2` means it found a compatibility blocker, and `1` means the harness failed. None means the two-browser proof passed. The report is `.generated/probe.json`; the full extraction inventory is `.generated/manifest.json`. `compatibility/vendor.json` is the reviewable pin, containing archive identity, chunk hashes, module IDs, and candidate factory hashes. Unknown archives and mismatched chunks are rejected.

## Measured results

Input version: `26.1103.32239`. Archive SHA-256: `63106325f6c5fb668e57323ece7c1b29d617877132096e9b856e7606b10c68fe`. The supplied plan identifies build `25471`; this harness has not independently verified that build number.

- 18,926 renderer files extracted with original relative paths, including lazy assets, fonts, styles, and notices.
- Static dependency closure of `V7mA` plus `Fkn8`: 565 module IDs. Static closure does not prove all runtime paths or dynamic imports are covered.
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

The generated `.generated/feasibility.json` explicitly distinguishes a passing
fixture workflow from the unpassed original-renderer/live-server proof. The
protocol test document is test-only; it is not a replacement product UI.

The host uses `CODEX_SOCKET_PATH`, optional `CODEX_UPGRADE_PATH`, and
`WEBUI_DATA_DIR`. With no socket configured it serves assets and explicit manager
diagnostics; it never chooses a socket or launches a server. See
`/manager-status` for current worker availability. A disconnected upstream closes
browser leases and requires host restart; automatic upstream reconciliation is
not implemented. No mutations are replayed.

## Remaining renderer compatibility work

A Chromium smoke experiment with the original scripts reaches account, config,
model-feature, and history calls through the facade, but remains on the startup
loader. Native tray, overlay, power-management, and other desktop messages are
currently rejected. ChatGPT HTTP services and cloud feature-flag fetching are
unavailable; the renderer attempts those independently of the real Codex account
state. No authentication or subscription status has been invented to unblock it.

The existing `cxUs` worker factory replacement remains the only vendor adaptation.
No renderer rewrite or DOM emulation has been added. A concrete additional patch
for the startup loader has not been established; the current evidence does not
justify claiming that a broad rewrite is necessary or that the milestone passed.
