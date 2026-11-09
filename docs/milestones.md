# Plans 2–4 implementation status

Plan 1's live proof is recorded in [verification](verification-2026-11-09.md).
The subsequent milestones are not yet complete.

## Implemented reliability increment

- Host retries initial connection failure and upstream disconnect with a fresh
  worker. Old facades close, pending operations reject, and mutations never replay.
- Legacy settings updates broadcast to simultaneous browser clients, with a
  snapshot before live events when an event stream connects or reconnects.
- Slow event-stream consumers disconnect; stream listeners dispose independently.
- Manager close is idempotent and rejects pending host requests immediately.
- Integration regression exercises settings broadcast, persistent state after
  worker restart, one central upstream connection, and zero mutation replay.

Validation: Node.js 22 build; 45 unit tests; 8 feasibility regressions (including
original-renderer desktop/narrow browser contexts); original archive and 18,926
extracted files unchanged. The configured TCP endpoint passed read-only initialize
and account acquisition. These checks do not constitute full milestone acceptance.

## Durable submission admission increment

Queued sends reserve a thread/message identity in the WebUI state file before
execution. Reservations survive worker/host restart. Successful and uncertain
turn deliveries remain fenced; confirmed unsent attempts can retry. Tests cover
concurrent claims, restart, interrupted reservations, distinct messages, and
unknown versus not-sent delivery errors. This does not cover arbitrary mutations
or certify the remaining workflow and service acceptance criteria.

Validation: Node.js 22 build, 46 unit tests, and all 8 feasibility regressions
pass (including original-renderer browser checks); source integrity check
verifies the original archive and all 18,926 extracted files. Reservations are
conservative after a crash: an unsent reservation may require a new explicit
submission with a new message identity. Ledger compaction and a user-facing
reconciliation workflow remain outstanding.

## Remaining acceptance work

Plan 2: complete workflow coverage for history pagination, thread creation,
rename/archive, interruption, follow-ups, model/directory selection, and delivery
deduplication; reconnect browser RPC facades without requiring a page reload;
validate disconnect timing and competing operations across all workflows.

Plan 3: implement and validate project/workspace selection and associations,
files/previews/uploads/diff review, Git/worktrees/PTY services through the existing
renderer, and verified skills/MCP controls. The existing startup root and state
persistence do not certify these feature groups.

Plan 4: extend compatibility and browser regression coverage to those services,
account changes during execution, slow clients, upstream restart before/after
mutation delivery, and complete production packaging review. Existing separate
prepare/check/build/start commands and exact-hash patches remain in place.

## Direct browser submission admission

Browser `startTurn` RPCs now reserve the same durable thread/message ledger used
by queued submissions before calling the central manager. Independent browser
facades cannot dispatch the same submission twice, including after host restart.
Missing message identities reject explicitly. Failed direct calls remain fenced
because an RPC rejection cannot prove that no mutation executed; inspect the
thread before submitting a new message with a new identity. Distinct identities
remain independent. The ledger has no automatic expiry.

This increment does not complete Plan 2. Automatic browser RPC facade recovery,
workflow acceptance for pagination/create/rename/archive/interrupt/follow-ups and
model/directory selection, and full disconnect-timing coverage remain outstanding.

## Browser transport recovery

Brief network outages now reconnect without a page reload or replacing browser
RPC facades. The host retains each browser's worker port and subscriptions for
30 seconds; the browser retries for 25 seconds. Sequence numbers and cumulative
acknowledgements recover missed frames while delivering each RPC instruction
once within that session. Buffers are bounded to 8 MiB per direction. A resumed
connection can replace a half-open transport. Separate browser sessions retain
independent disposal and buffers.

An expired session or a replaced host worker explicitly ends RPC recovery.
Instructions are never replayed into a fresh worker. Automatic service/facade
recreation after upstream or host restart remains outstanding.

Validation includes lost acknowledgement replay, sequence validation, buffer
limits, and simultaneous desktop/narrow browser transport loss during streaming,
with retained callbacks, subsequent approval arbitration and one upstream turn.
