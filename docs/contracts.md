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

The intended transport is a Node WebSocket client connected through AF_UNIX with ordinary JSON frames. Its socket path must be explicit; `/rpc` is the proposed upgrade-path default. No transport implementation is included yet, and no existing server process or configuration has been changed.

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
