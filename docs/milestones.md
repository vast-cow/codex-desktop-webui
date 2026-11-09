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
