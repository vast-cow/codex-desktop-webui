# Feasibility status

The first milestone remains incomplete. No later milestone is implemented. The CLI harness is runnable, but there is no browser host, working renderer service facade, account integration, or upstream connection yet. Do not interpret successful module import as successful manager execution.

## Reproducing the experiment

Use Node.js 22 and `npm ci`, then run the commands in the README. `assets:prepare` reads the archive without executing vendor code, copies the complete `webview/` tree plus the distribution's third-party notices into `.generated/`, and records all extracted file hashes. It generates a separate HTML entry with a same-origin CSP and a diagnostic bridge loaded ahead of vendor scripts. That bridge explicitly rejects native requests; it does not provide host services. Browser routing and startup remain to be implemented and verified.

The compatibility check compiles TypeScript and starts a dedicated Node worker. The worker verifies the pinned archive identity and the hashes of 19 dependency chunks. It uses Acorn to extract only inert Rspack factory tables, indexes their exports, and invokes the two requested module factories with their dependencies. Neither Electron startup nor renderer startup is evaluated. The VM isolates module globals and limits factory execution time; it is not a security boundary for hostile vendor code.

Exit codes: `0` means the unadapted import probe loaded, `2` means it found a compatibility blocker, and `1` means the harness failed. None means the two-browser proof passed. The report is `.generated/probe.json`; the full extraction inventory is `.generated/manifest.json`. `compatibility/vendor.json` is the reviewable pin, containing archive identity, chunk hashes, module IDs, and candidate factory hashes. Unknown archives and mismatched chunks are rejected.

## Measured results

Input version: `26.1103.32239`. Archive SHA-256: `63106325f6c5fb668e57323ece7c1b29d617877132096e9b856e7606b10c68fe`. The supplied plan identifies build `25471`; this harness has not independently verified that build number.

- 18,926 renderer files extracted with original relative paths, including lazy assets, fonts, styles, and notices.
- Static dependency closure of `V7mA` plus `Fkn8`: 565 module IDs. Static closure does not prove all runtime paths or dynamic imports are covered.
- Bundled Cap'n Web `Fkn8` imports successfully without a DOM.
- Unadapted `V7mA.O3` fails during import at `cxUs` in `async/23568.d16db37dce.js`: its named-entity decoder eagerly creates a DOM element.
- A single worker-only factory replacement for `cxUs` lets the manager export load as a function without any DOM shim. This does not instantiate the manager or exercise its methods.

## Smallest candidate adaptation

`cxUs` exports `s(name)`. It constructs `&name;`, decodes it through an element's `innerHTML`/`textContent`, and returns the decoded text or `false`. The experiment substitutes `entities.decodeHTMLStrict` with the vendor's trailing-semicolon and unchanged-input checks. This is an original worker adapter, not a modification to any extracted file. Browser-versus-library parity for the complete named-entity corpus remains unverified.

The candidate's exact factory target, expected input hash, purpose, and replacement hash are in `compatibility/vendor.json`. Both factory hashes are checked before replacement. No vendor file patches are applied (`patches: []` in the extraction manifest). Broad DOM emulation and vendor rewrites are neither needed for this import nor justified by the evidence so far.

## Remaining gate

The next step is to instantiate one manager with explicit host adapters, then expose per-browser facades over that single instance. Required acceptance checks remain unperformed: real-server history, turn submission, streamed updates, competing approval responses, browser reconnect, and simultaneous operation from two browsers. There is no single-client substitute.

The real upstream Unix socket path has not been supplied. Do not discover a random local socket or start a replacement server. The target server's protocol version, account state, and supported initialization capabilities still require verification. Its documented lifecycle is `initialize` then `initialized`; see the [official app-server documentation](https://learn.chatgpt.com/docs/app-server). No calls or mutations have been sent to any server.

`assets:check` rehashes the input archive and every extracted renderer file. Unit tests cover ASAR byte preservation, unsafe paths, truncation, factory-only loading, cyclic imports, export forms, and explicit browser-dependency errors. Browser smoke tests and workflow acceptance tests remain pending.
