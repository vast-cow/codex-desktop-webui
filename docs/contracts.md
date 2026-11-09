# Observed host contracts

These observations come from the pinned packaged modules, not an asserted complete implementation contract. Module import and central-manager execution have been exercised; the original renderer workflow also passes against a temporary protocol fixture; the pinned live-server workflow now passes as recorded in [the dated verification](verification-2026-11-09.md). The [account service contract](account-compatibility.md) describes the standalone authentication boundary.

## Central manager

`V7mA.O3` is the manager constructor. Its options destructure the following services:

- `hostId`, `transport`, `logger`, `pendingThreadArchives`, `sendAppServerResponse`, `sendApprovalResponse`, and `threadExecution`.
- `ipcBridge`, `coordination`, and `scheduler`.
- `storage`, `threadProjectAssignments`, `savedReadState`, and `filesystem`.
- `runtime`, `settings`, `tracing`, `useTailHydration`, and `runtimeSettings`; optional lifecycle/account availability services are also referenced.

The constructor checks `transport.hostId === hostId`. It constructs ownership coordination, queued follow-up handling, history pagination, resume recovery, workspace membership, filesystem watches, unread state, attachment services, account lifecycle, and thread discovery. `manager-adapters.ts` now supplies explicit local services for the fixture-tested execution paths. Supplying empty objects would not be a valid manager integration. Explicit adapters and meaningful unsupported-operation errors are required.

Keep one manager independent of browser lifetimes. RPC stub disposal must release only the browser's leases/subscriptions. Manager retirement is a distinct host operation. The vendor manager plus host transport now pass competing-approval and browser-reconnect tests. Queued submission admission is persisted before dispatch; automatic upstream reconciliation remains incomplete.

## Renderer services

Module `hms3` requires `appServices.appServerManagers`. Observed calls include `dup()`, `subscribe(hostId, callback)`, and `openAccount(hostId)`. Subscription callbacks carry statuses; a ready status includes a manager RPC capability. The renderer duplicates that capability, attaches RPC-break handlers, creates event/notification subscriptions, and disposes leases via `Symbol.dispose`. The account capability is separately subscribed and disposed.

Module `Wbxh` requires `appServices.applicationState`, including `read(key)` returning `{value}` and `write(key, value)` returning `{success}`. Thread membership, project catalog, project presentation, and thread metadata can have separate service overrides. A generic WebSocket JSON relay cannot reproduce these capabilities or their lifecycle.

The core capability table below records appInfo, account state, workspace initialization and bootstrap transport; the source inventory records the wider legacy message surface. Do not fabricate login or subscription status to satisfy renderer startup. The bridge now transports the existing bootstrap port and reports unavailable native operations.

## Upstream and application boundaries

The intended transport is a Node WebSocket client connected through AF_UNIX with ordinary JSON frames. Its socket path must be explicit; `/rpc` is the proposed upgrade-path default. The original AF_UNIX transport is implemented in `src/upstream.ts` and fixture-tested. The worker now connects it to the vendor manager. No existing server process or configuration has been changed.

The future host must keep credentials server-side and WebUI state separate from desktop state. Browser clients share the configured account and host workspace access, with no WebUI authentication. The intended listener is `0.0.0.0:3000`; browser URLs must stay relative to their origin. ChatGPT chat, Pages, and other unrelated cloud products must remain outside the implemented surface. The diagnostic entry's CSP permits only the serving origin for connections.

## Reproducible constructor inventory

The compatibility worker now includes `managerContract` in `.generated/probe.json`.
It statically resolves the `O3` export and inspects its constructor's options
binding without executing the constructor. The pinned bundle exposes 19 bindings;
five have default expressions. A default expression is not evidence that a service
can safely be omitted during real execution. Other options accessed indirectly
(such as lifecycle and account availability) are outside this inventory.

The scanner rejects missing exports, unsupported constructor signatures, and
missing bindings. Tests verify inert inspection and rejection of changed shapes.
This inventory guides adapter implementation; it does not constitute constructor
execution or satisfaction of the two-browser proof gate.

## Upstream transport probe

Run `CODEX_SOCKET_PATH=/absolute/path/to/server.sock npm run upstream:check`.
Alternatively, use `CODEX_SERVER_URL=ws://127.0.0.1:4500/ npm run upstream:check`
for TCP; see [connection settings](network.md#existing-app-server).
Set `CODEX_UPGRADE_PATH` for Unix sockets if the upgrade path differs from `/rpc`. The probe
initializes one connection, reads the actual account state, reports only the
account type, and disconnects. It never starts, stops, or configures a server.
The [official lifecycle](https://learn.chatgpt.com/docs/app-server) specifies
`initialize` followed by `initialized`; real-server compatibility remains unverified.

Transport fixtures exercise a real WebSocket upgrade over a temporary Unix socket.
They cover concurrent request correlation, first-response approval arbitration,
missing sockets, wrong paths, incompatible initialization, malformed frames, and
reconnection without replaying sent mutations. Sent requests rejected by a disconnect
or timeout have an `unknown` outcome; requests rejected before sending have a
`not-sent` outcome. Reconnection is explicit and repeats initialization. This transport layer alone does not provide state reconciliation; browser facades and durable admission are supplied by the worker layers described below.

## Host state and scheduling adapters

`HostState.open(dataDirectory)` loads `webui-state.json` from a WebUI-owned
application data directory. The caller must choose a location separate from the
desktop application's files. The worker exposes it through the application-state service and legacy persisted-atom bootstrap.
It implements `readValue`, `writeValue`, `readGlobalState`, `updateGlobalState`,
and the observed application-state `read`/`write` result envelopes.

One host must own each directory; independent processes sharing a directory are
not supported. Concurrent updates within that host are serialized. Writes use a
private temporary file, fsync, and atomic rename before publication. Values use
JSON serialization semantics; `undefined` deletes a key. Corrupt state fails at
startup instead of silently resetting preferences. Each subscriber receives a
cloned initial snapshot synchronously, then committed revisions in order. Disposal
removes only that subscriber. Failed subscribers cannot interrupt other listeners.
Tests cover concurrent updates, reopening persisted state, subscription disposal,
failed writes, and corrupt state.

`HostScheduler.schedule(callback, delayMs)` matches the observed manager calling
convention and returns an idempotent cancellation function. Host disposal cancels
all pending callbacks. It deliberately omits browser animation-frame methods so
the manager uses its observed timer fallback.

### Microtask scheduling

The pinned `V7mA.O3` constructor also passes
`this.scheduler.scheduleMicrotask` unbound into the passive-thread unsubscriber
(`nT`). That helper schedules inactive-thread release after thread notifications,
stream-role changes, and history hydration. Its original adapter calls
`queueMicrotask(callback)`; a timer alone does not satisfy this contract.

`HostScheduler.scheduleMicrotask` now supplies that operation without a DOM.
It preserves microtask ordering, supports use as an unbound callback, and ignores
queued callbacks after host disposal. Scheduling new work after disposal throws,
as with timer scheduling. Microtasks do not return individual cancellation handles
in the observed vendor contract. Tests exercise ordering before timers, nested
scheduling, and disposal from an earlier queued callback. This closes one adapter
gap; manager instantiation and two-browser fixture tests now pass, while the live gate remains unverified.

The constructor inventory also records `storedServicePaths`: syntactic member
paths rooted at `this.<constructor-service>` within the manager class. This
includes references in methods, such as `scheduler.scheduleMicrotask`, which the
constructor binding list alone misses. Computed nonliteral members are excluded.
These are source references, not verified callable signatures or requiredness:
helper functions, renamed fields, aliases, and runtime-selected members still
require separate tracing before writing adapters.

## Worker and browser boundaries

`SharedManager` starts compiled JavaScript in a dedicated worker, avoiding loader
injection into code evaluated in the vendor VM. The worker verifies pinned
factory hashes, applies only the recorded `cxUs` substitution, creates one manager,
and owns its transport, scheduler, and WebUI state for the host lifetime.

Each browser's `connect-app-host` port gets an independent root service and
registry/account capabilities. Subscription leases dispose retained callbacks,
while the manager remains host-owned. Account reads use the upstream server.
The initialize result is not treated as a semantic server version: version-gated
features stay disabled when no version is configured. `CODEX_SERVER_VERSION` is an explicit operator assertion about the configured target, never a version inferred from client metadata.

The WebSocket carries a tagged JSON representation of Cap'n Web's structured
frames, preserving `undefined`, bytes, big integers, and nonfinite numbers. On
worker ingress, arrays and records are recreated in the vendor VM: prototype
identity is significant to the bundled RPC decoder. Transport errors also become
VM-realm Errors so they can cross the RPC boundary without serialization failures.

Implemented startup capabilities include `appServerManagers`, account reads/auth
subscriptions, `applicationState`, `appInfo`, `startup`, and the default execution
host. Persistent thread workspace associations and unread state use the WebUI
store. Desktop dynamic tools and managed-worktree deletion fail explicitly. Archive intents persist until the upstream archive succeeds or the user unarchives the thread.
The facade is incomplete for other renderer services.

### Runtime services exercised by the original renderer

The browser bridge supplies `initial-route` metadata from the browser URL before
the renderer imports its route module. The legacy `request-app-server-state`
response reports the worker's real connection state and its explicitly configured
semantic version. `workspaceRoots.read()` returns the validated host workspace;
`executionPaths` returns host home paths, and `startup.reach()` records milestones.
Optional automatic input resolution is represented as disabled with no optional
activity methods, so the renderer does not attempt automatic decisions.

The worker's disposal-stack adapter uses the VM's disposal symbol and prototypes.
Persistent-record edits reuse `waIq.m`, including expected-value checks, merging
independent edits instead of overwriting whole draft maps. Queue execution uses
independent per-thread start locks and per-message send locks. Queued message IDs are recorded in the WebUI delivery ledger before admission.
Concurrent claims for the same thread/message pair have one winner. Successful
or uncertain turn delivery retains the claim even if the manager releases with
`sent=false`. Confirmed unsent attempts can release their claim for retry. A crash
leaves the reservation in place: safety takes priority over automatically retrying
a potentially delivered mutation. Distinct message IDs remain independent. This
ledger covers queued sends and direct browser turn starts, not arbitrary RPC mutations. It is
host-owned, not browser-owned, and currently has no automatic compaction.

## Recovery and legacy event synchronization

The HTTP host supervises its central worker. Failed startup and upstream loss
trigger a retry every three seconds; retries are serialized and the previous
worker is closed before a replacement starts. Each replacement acquires current
account state and initializes a new upstream connection. Pending operations are
rejected, never transferred to the new worker. Existing browser RPC leases close;
reload after host recovery to establish new facades and obtain current history.

`GET /bridge-events` carries JSON SSE data frames for legacy settings events.
The host subscribes before requesting the persisted-atom snapshot, queues changes
while it loads, then sends the snapshot followed by queued/live changes. Settings
writes are serialized by HostState and broadcast to all event-stream consumers.
The POST response does not duplicate the broadcast. Stream disposal removes its
listener and heartbeat; slow consumers disconnect rather than accumulate an
unbounded response buffer. Application-state persistence remains host-owned and
separate from desktop files. This transport does not implement terminals or file
browser services.


## History and browser mutation dispatch

History pagination uses the hash-pinned bundle's `Ehlj.qh` version gate. Unknown
or older server versions retain legacy history loading. Supported versions enable
tail hydration and older-turn/item pagination through the original manager.
Thread-creation settings are normalized into the vendor VM before crossing
callback RPC boundaries.

Browser turn starts and follow-ups share a per-thread mutation queue. Different
threads proceed independently. Distinct submissions remain separate; a later
follow-up observes the preceding dispatch before choosing whether to start or
steer a turn. A failed dispatch does not block subsequent submissions.

Brief browser network outages retain the worker's RPC session for 30 seconds;
the browser retries for 25 seconds. Sequence numbers and acknowledgements recover
missed frames without delivering an RPC instruction twice in that session. Each
direction has an 8 MiB buffer limit. Expired sessions and replaced workers fail
explicitly, and their instructions never replay into a new worker.

## Core renderer audit (2026-11-09)

Scope is local Codex thread discovery, creation/resume, history, turn execution,
approvals, settings and their subscriptions. The renderer also contains ChatGPT,
Pages, voice, browser automation, terminals and native window integrations. Those
are not requirements to emulate with successful no-ops.

The reproducible [source inventory](renderer-inventory.json) records direct
service references, literal legacy message candidates (including their argument expressions; postMessage can also target other transports),
and the pinned manager facade's method bodies. Run
`npm run build && npx tsx scripts/inventory-renderer.ts` after asset preparation.
It scans generated copies only. Facade bodies preserve the actual minified
arguments, forwarding expressions and return values instead of assigning guessed
types to vendor records. Dynamic messages are marked explicitly. Static references
alone cannot prove that every optional feature is reachable in a core workflow.

### Implemented foundational capabilities

All methods cross Cap'n Web as asynchronous calls, even when their local body
returns synchronously. `dup`, `onRpcBroken` and `Symbol.dispose` belong to the
RPC runtime, not the upstream app-server protocol.

| Capability | Arguments → result | Ownership, lifecycle and errors | Status |
| --- | --- | --- | --- |
| appServerManagers.subscribe | hostId, callback → disposable lease; callback({status:"ready", manager}) | Validates host ID. Each call creates a separate vendor facade over the single manager. Releasing a lease releases its retained callback, never the manager. | Implemented |
| appServerManagers.openAccount | hostId → account capability | Unknown host throws. Account lifetime is separate from registry subscription. | Implemented |
| manager.subscribe | {type, key, listener, methods? / event?} → lease | Vendor supports host/thread/subagentTitle/turn/item/notification/conversation/event subscriptions. Events are scoped to the independent facade; vendor owns caches and upstream notification processing. | Vendor implementation reused |
| manager.registerReplayAdmission | callback(thread, followUpContext) → lease | Vendor duplicates callback and releases on RPC break or lease disposal. Admission does not authorize replay after uncertain delivery. | Vendor implementation reused |
| manager.subscribeOpeningTurnContext / addConversationHistoryInvalidationListener | listener → lease | Vendor callback adapters own retained callback references. Browser retirement must not retire the shared manager. | Vendor implementation reused |
| account.sendRequest | method, params, options → upstream result | Same shared transport; rejects upstream failures. Auth/account reads redact credentials. | Implemented |
| account.getAccount / getAuthMethod | options → actual upstream account/auth result | No fabricated login, plan or subscription. | Implemented |
| account.subscribeAuthStatus | callback → lease | Duplicates callback; removes only its exact manager listener on disposal. Rejected callbacks are contained. | Implemented |
| codexAccount.read / subscribe | () → snapshot; callback(snapshot) → lease | Host owns actual acquired/acquiring/unavailable state. Initial and subsequent snapshots are queued in order. Disposal suppresses pending callbacks. | Implemented; see account contract |
| applicationState.read / write | key → {value}; key,value → {success:true} | Shared WebUI HostState; success only after durable write. No applicationState subscription is asserted. Storage errors reject. | Implemented |
| settings.read / readAll / write | key → {effective}; () → {values}; key,value → void | Shared WebUI preferences in renderer-setting namespace, separate from upstream execution config. Missing effective values remain undefined so renderer defaults apply. Invalid keys and persistence failures reject. | Added |
| settings.subscribe | key, callback({effective}) → lease | Initial snapshot then changed committed values; unrelated state commits emit nothing. Each browser has its own retained listener and ordered callback queue. Disposal is idempotent, suppresses pending callbacks and leaves other sessions subscribed. | Added |
| appInfo.get / getPackagingInfo / getLocaleInfo / getSystemInfo | () → app metadata / {isPackaged:false} / locale record / {platform,arch} | Host metadata; locale currently fixed en-US. No subscriptions. | Implemented, fixed locale limitation |
| startup.whenReady / isSentryEnabled / reach | () → null / false; phase → void | Host is ready before attach; telemetry disabled; milestone set belongs to facade. | Implemented |
| executionHosts.getDefaultHost | () → hostId | Returns the actual shared manager host. No fabricated remote hosts. | Implemented |
| workspaceRoots.read / cancel | requestId, options → {roots,labels}; requestId → void | Validated host root; immutable snapshot. No background operation exists to cancel. | Implemented, single root |
| executionPaths.readHomePaths / readCodexHome / readHomeDirectory | () → {codexHome,workspacesRoot} / string / string | Host filesystem paths, never browser paths. Read-only, no subscriptions. | Implemented |
| requestUserInputAutoResolution.enabled | property → false | Disabled capability; optional activity methods absent. Approvals still use the manager. | Explicitly disabled |

### Thread and execution delegation

The exact callable surface is under `managerFacade` in the inventory. Core
operations include refreshRecentConversations, getCachedThreadSearchSnapshot,
resumeConversation, getConversation, getLoadedConversationHistory, startTurn,
sendFollowUpMessage, interruptConversation and the approval response operations exposed
by the vendor. Their argument and return contracts are those of the pinned vendor
forwarders and computed snapshot methods, reproduced there without replacement.

The manager owns thread caches, streaming state, history pagination, queued
follow-ups, and approval arbitration. The app server owns execution and canonical
thread state. HostState owns drafts, unread state, workspace assignments and the
delivery ledger. The browser owns presentation and RPC references only.
startTurn and sendFollowUpMessage are overridden solely to serialize mutations
per thread and admit delivery safely. Upstream errors propagate as VM-realm
Errors; uncertain mutation outcomes are never automatically replayed.
thread/start, thread/resume and turn/start config flags remove null placeholders;
config/read remains authoritative for execution settings.

Optional threadMetadata, threadProjectAssignments, projectCatalog,
projectPresentation and localThreadCatalog services remain absent: the observed
renderer uses applicationState or vendor-manager fallback paths. There is no
second cache pretending to own these records. threadConfiguration's
readDeveloperInstructions and readMcpConfig are not implemented; custom native
instruction assembly is a remaining contract gap, not an empty successful result.
No app-server capability for desktop instruction generation has been assumed.
settings.writeForAgent and account-scoped agent settings are also unsupported;
adding local preferences does not supply agent control of settings.

### Legacy electronBridge

| Message and arguments | Result/event | Ownership and status |
| --- | --- | --- |
| connect-app-host, transferred port | root RPC capability over port | Browser bootstrap; independent resumable RPC session over shared worker. Not an HTTP legacy mutation. |
| electron-window-focus-request | electron-window-focus-changed {isFocused} | Browser-local document.hasFocus; implemented without native focus claims. |
| request-app-server-state | codex-app-server-connection-changed {hostId,state}; when connected codex-app-server-initialized {hostId,appServerVersion} | Actual shared transport state; version may be null. |
| persisted-atom-sync-request | persisted-atom-sync {state,canWritePrimaryWindowTabPersistence:true} | Snapshot of host WebUI persisted-atoms; not desktop files. |
| persisted-atom-update {key,value?,deleted?,recordUpdate?} | persisted-atom-updated {key,value,deleted} | Serialized host commit, vendor expected-value record merging, broadcast once through SSE to every browser. |
| All other direct or dynamic native messages in inventory | HTTP error; unsupported native messages map to 501 | Explicit rejection and browser unavailable-integration diagnostic; no misleading success. |

POST failures reject sendMessageFromView. GET /bridge-events subscribes before
snapshot acquisition and then drains buffered changes, preserving bootstrap order.
SSE close releases that stream only. RPC recovery retains leases during a bounded
outage; expiry or worker replacement ends them and requires fresh facades.
Session cleanup and lease disposal now share a single idempotent cleanup wrapper.

### Verification limits

The source inventory is evidence for auditing, not a generated TypeScript schema:
aliases, runtime-selected methods and dynamic message payloads need manual tracing.
Consequently this audit does not assert exhaustive semantic coverage of every
renderer interface. Native developer-instruction assembly remains unsupported.
The focused settings tests and existing two-browser regressions cover implemented
foundations; they do not establish support for extended desktop features.

Audit validation: 51 unit tests and 8 feasibility tests passed, including the
original desktop/narrow renderer, account states, host recovery and independent
two-browser facades. The final settings reconnect regression also passed
separately. Compatibility probing passed; asset integrity verified the original
archive and 18,926 extracted files. Browser tests used the existing Chromium cache
at /tmp/webui-playwright. No existing app server was started or reconfigured.
The evidence inventory contains 195 direct service names, 119 message candidates
(including dynamic/non-Electron candidates), and 173 facade members.
