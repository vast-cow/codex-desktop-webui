# Account compatibility and Plan 1 verification — 2026-11-09

**Plan 1 passed** for the pinned renderer and operator-supplied app-server version
`0.166.0`, using `ws://127.0.0.1:4500/` and a real ChatGPT account.
The recorded run began at `2026-11-09T04:52:43.195Z` (13:52:43 JST), completing at `2026-11-09T04:54:14.972Z` (13:54:14 JST).
Runtime: Node.js 22.23.2. No app server was started, stopped, reconfigured, or
logged out. Only the temporary WebUI child hosts were stopped.

## Measured live results

| Criterion | Result |
| --- | --- |
| Initialize and acquire real account | Passed: ChatGPT, token-free acquisition |
| Open original Codex from / | Passed using the existing new-thread route |
| Independent desktop and 390px browser contexts | Passed |
| Create a dedicated new test history and load it in both | Passed |
| Send through original composer and observe output in both | Passed |
| Actual harmless approval displayed in both | Passed |
| Conflicting Allow once and Deny responses | Passed: one upstream response |
| Close one page during streaming; other continues | Passed: further stream deltas observed after closure |
| Reconnect and restore accumulated history | Passed |
| No duplicate sends/approvals; shared central runtime | Passed: counts below |

The host recorded `1` upstream connection,
`2` turn-start dispatches (approval-triggering turn
and original-composer streaming turn), `1` actual
approval request, `1` approval response, and
`1247` agent-message deltas. Both browser contexts used the
same worker and connection. A separate preparatory connection seeded the new
history and closed before the verification host started. Assertions required
output in both contexts before closing one, more deltas after closing it, and
restored output in a fresh page without another submission. The delta count was
62 at closure and 1,247 after recovery. Two explicit, conflicting approval RPC
calls were issued through independent browser facades; exactly one upstream
response was recorded.

The approval turn requested a Python write confined to the dedicated ignored
workspace with a per-turn `untrusted` policy; it did not change server settings.
The conflicting decision race may allow or deny that harmless operation. Test
workspaces and reports remain under `.generated/live-runs/` for inspection.
The generated report is `.generated/live-runs/run-8fABlm/report.json`. It contains
only identities, timestamps, outcomes, and numeric counters, without account
identity, credentials, or conversation content. See the [repeatable procedure](account-compatibility.md#automated-live-procedure).

## Automated checks

- Build: passed.
- Unit tests: 45 passed, covering account states, timeout, stale response fencing,
  account changes, independent leases, token request suppression, response
  filtering, absent session-config placeholders, and preservation of explicit
  environment policies and falsy values.
- Browser regression: 7 passed, including no-auth-required, unauthenticated, invalid, and timeout
  state displays plus the API-key fixture, ChatGPT fixture at version 0.166.0, and
  shared-manager protocol workflow; desktop and 390px contexts. History, original
  composer, stream, competing approvals, disposal, updates, and reconnect pass.
- Asset verification: original archive and all 18,926 extracted files unchanged;
  generated bridge/entry and separate patched chunk verified. Patches are
  deterministic, reject unknown input, and reject stale generated output.
- Unadapted compatibility probe: expected exit 2 for the existing DOM-dependent
  cxUs import; its narrowly adapted import succeeds. This is not a new failure.

The fixture may log Request not found when the losing approval callback arrives
after resolution; assertions require exactly one upstream response. Deliberate
host shutdown also logs its disconnection. Neither substitutes for live evidence.

## Resolved live blockers

Effective config/read responses contain absent fields represented as null.
Echoing them into TOML session flags caused shell_environment_policy and then
history.max_bytes decoding failures. The host now omits absent object fields
while preserving explicit strings, booleans, numbers, arrays, and actual policies.
No execution configuration was removed to bypass validation.

The 0.166.0 send path required history.readThreadTimelineEnabled, absent from the
older fixture's path. The adapter explicitly disables this unimplemented feature,
and the ChatGPT regression now uses the real target version. Before that fix the
queued-message reason named this missing method and zero turn dispatches were
observed; successful live dispatches were required after correcting it.

A browser ResizeObserver deferred-notification warning was incorrectly promoted
to a fatal bridge overlay during approval layout. Only the two exact non-exception
browser diagnostics are excluded; renderer exceptions and host errors remain
visible. A browser regression injects the deferred-notification event.

## Asset and patch identities

Renderer application: `26.1103.32239`.

- Archive: `63106325f6c5fb668e57323ece7c1b29d617877132096e9b856e7606b10c68fe`
- Input chunk: `11870f9f8005c5fce0e422bb6aad4840478b1110fe8086a97e7020afc64ce830`
- Original cE1j: `69f213498651cee70987e26e77b5ac7fc2ee0db7fdf5ef3b19ffe47260077535`
- Original eFn4: `26e4a650c39c242a1af44dcb5607a9e5cb1d83b9268362cbb33a0e2e4dedb526`
- Generated chunk: `b942d21e0c7c76c8f6ffd205ebae3d3dbdc5fdddc3f1f7849adf97af53bbdc7b`
- Provider replacement: `ef588cba36382086d91bdac10bff6e7aae091c50788e47259c5035a34b3037e4`
- Access factory output: `f66b76dff3ca656d3a34b8b1970399032726e4d16e323e93b8538869ebc77c71`

The browser patch targets cE1j and the local selector in eFn4 in
webview/assets/async/182735.d3d917f28d.js. Original extraction remains unchanged;
only the generated patched copy is served. The worker's existing cxUs adapter
remains pinned in compatibility/vendor.json. This evidence applies to these
identities and this server version; it does not certify upgrades or Plans 2–4.
The host's ready status still means connection readiness, and its proofGate field
does not embed or certify this external verification record.
