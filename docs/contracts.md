# Observed host contracts

These observations come from the pinned packaged modules, not an asserted complete implementation contract. Module import and central-manager execution have been exercised; the original renderer workflow also passes against a temporary protocol fixture; the pinned live-server workflow now passes as recorded in [the dated verification](verification-2026-11-09.md). The [account service contract](account-compatibility.md) describes the standalone authentication boundary.

## Central manager

`V7mA.O3` is the manager constructor. Its options destructure the following services:

- `hostId`, `transport`, `logger`, `pendingThreadArchives`, `sendAppServerResponse`, `sendApprovalResponse`, and `threadExecution`.
- `ipcBridge`, `coordination`, and `scheduler`.
- `storage`, `threadProjectAssignments`, `savedReadState`, and `filesystem`.
- `runtime`, `settings`, `tracing`, `useTailHydration`, and `runtimeSettings`; optional lifecycle/account availability services are also referenced.

The constructor checks `transport.hostId === hostId`. It constructs ownership coordination, queued follow-up handling, history pagination, resume recovery, workspace membership, filesystem watches, unread state, attachment services, account lifecycle, and thread discovery. `manager-adapters.ts` now supplies explicit local services for the fixture-tested execution paths. Supplying empty objects would not be a valid manager integration. Explicit adapters and meaningful unsupported-operation errors are required.

Keep one manager independent of browser lifetimes. RPC stub disposal must release only the browser's leases/subscriptions. Manager retirement is a distinct host operation. The vendor manager plus host transport now pass competing-approval and browser-reconnect tests. Durable mutation deduplication and automatic upstream reconciliation remain unimplemented.

## Renderer services

Module `hms3` requires `appServices.appServerManagers`. Observed calls include `dup()`, `subscribe(hostId, callback)`, and `openAccount(hostId)`. Subscription callbacks carry statuses; a ready status includes a manager RPC capability. The renderer duplicates that capability, attaches RPC-break handlers, creates event/notification subscriptions, and disposes leases via `Symbol.dispose`. The account capability is separately subscribed and disposed.

Module `Wbxh` requires `appServices.applicationState`, including `read(key)` returning `{value}` and `write(key, value)` returning `{success}`. Thread membership, project catalog, project presentation, and thread metadata can have separate service overrides. A generic WebSocket JSON relay cannot reproduce these capabilities or their lifecycle.

`appInfo`, account state, workspace initialization, service bootstrap transport, and the complete legacy `electronBridge` message schema remain to be traced and implemented. Do not fabricate login or subscription status to satisfy renderer startup. The bridge now transports the existing bootstrap port and reports unavailable native operations.

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
`not-sent` outcome. Reconnection is explicit and repeats initialization. This layer
does not yet provide state reconciliation, browser facades, or durable deduplication.

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
store. Desktop dynamic tools and deferred archive operations fail explicitly.
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
independent per-thread start locks and per-message send locks. Accepted message
IDs are retained for the worker lifetime; durable transport-level deduplication
across process restarts remains outside this milestone.

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
