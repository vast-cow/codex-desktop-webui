# Observed host contracts

These observations come from the pinned packaged modules, not an asserted complete implementation contract. Only module import has been exercised.

## Central manager

`V7mA.O3` is the manager constructor. Its options destructure the following services:

- `hostId`, `transport`, `logger`, `pendingThreadArchives`, `sendAppServerResponse`, `sendApprovalResponse`, and `threadExecution`.
- `ipcBridge`, `coordination`, and `scheduler`.
- `storage`, `threadProjectAssignments`, `savedReadState`, and `filesystem`.
- `runtime`, `settings`, `tracing`, `useTailHydration`, and `runtimeSettings`; optional lifecycle/account availability services are also referenced.

The constructor checks `transport.hostId === hostId`. It constructs ownership coordination, queued follow-up handling, history pagination, resume recovery, workspace membership, filesystem watches, unread state, attachment services, account lifecycle, and thread discovery. Supplying empty objects would not be a valid manager integration. Explicit adapters and meaningful unsupported-operation errors are required.

Keep one manager independent of browser lifetimes. RPC stub disposal must release only the browser's leases/subscriptions. Manager retirement is a distinct host operation. Approval arbitration, mutation idempotency, unknown-outcome handling, snapshot ordering, and upstream reconnection still need implementations and tests.

## Renderer services

Module `hms3` requires `appServices.appServerManagers`. Observed calls include `dup()`, `subscribe(hostId, callback)`, and `openAccount(hostId)`. Subscription callbacks carry statuses; a ready status includes a manager RPC capability. The renderer duplicates that capability, attaches RPC-break handlers, creates event/notification subscriptions, and disposes leases via `Symbol.dispose`. The account capability is separately subscribed and disposed.

Module `Wbxh` requires `appServices.applicationState`, including `read(key)` returning `{value}` and `write(key, value)` returning `{success}`. Thread membership, project catalog, project presentation, and thread metadata can have separate service overrides. A generic WebSocket JSON relay cannot reproduce these capabilities or their lifecycle.

`appInfo`, account state, workspace initialization, service bootstrap transport, and the complete legacy `electronBridge` message schema remain to be traced and implemented. Do not fabricate login or subscription status to satisfy renderer startup. The diagnostic bridge intentionally reports missing host services.

## Upstream and application boundaries

The intended transport is a Node WebSocket client connected through AF_UNIX with ordinary JSON frames. Its socket path must be explicit; `/rpc` is the proposed upgrade-path default. The original AF_UNIX transport is implemented in `src/upstream.ts` and fixture-tested. It is not yet connected to the vendor manager. No existing server process or configuration has been changed.

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
Set `CODEX_UPGRADE_PATH` if the upgrade path differs from `/rpc`. The probe
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
desktop application's files. The adapter is not yet wired into renderer bootstrap.
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
gap; manager instantiation and the two-browser gate remain unverified.

The constructor inventory also records `storedServicePaths`: syntactic member
paths rooted at `this.<constructor-service>` within the manager class. This
includes references in methods, such as `scheduler.scheduleMicrotask`, which the
constructor binding list alone misses. Computed nonliteral members are excluded.
These are source references, not verified callable signatures or requiredness:
helper functions, renamed fields, aliases, and runtime-selected members still
require separate tracing before writing adapters.
