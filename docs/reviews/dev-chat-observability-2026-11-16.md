# Development chat timing boundaries

This adds observability, not a latency improvement. Production and other stages
retain the previous worker event and emit no new API event. No new DB statement,
provider call, persistent identifier, metric dimension or analytics transport.

Development may log the existing server-generated reply request UUID for internal
API/worker correlation. This is an identifier, not anonymity. Readers must strip
it and never export it or use it as a metric dimension. No profile/account/chat/
source IDs, words, context hashes, headers, credentials or raw errors are logged.

The single API completion event measures original transaction, sweep and wake
awaits before response construction; the body-exit to resolution tail includes
commit/driver/network completion and is not pure COMMIT time. Rejected/unknown
transactions are unconfirmed, never described as rolled back. Replays and the
standalone Retry path are marked separately. Worker timing reuses its existing
event and already-read revision. Buckets describe revision positions, not bytes,
exact history length or model-input length: first1, ordinary2–30, middle31–119,
long120–200, unknown. No warm/DB-connection or browser-paint claim follows.

Exact field/reader compatibility and local verification are recorded with the
candidate. Existing readers may ignore additional development worker fields;
the frozen first collector intentionally does not collect the new API marker
or export the correlation UUID. A reviewed reader extension is required before
claiming an API-to-worker causal trace. Browser delivery remains unmeasured.


## Events and interpretation

`[conversation-api-timing]` contains one JSON body, capped at1,024 UTF8 bytes:

| Field | Meaning |
|---|---|
| event / Stage / operation | conversation_api_timing / development / create, message or retry |
| requestId | Optional existing technical reply UUID; no ID is invented for unlinked create/message replays |
| admission | new, replay or unlinked; this describes body observation, not durable success |
| transactionOutcome | resolved only after the original transaction promise resolves; otherwise unconfirmed |
| responseReady | Original transaction/sweep/wake awaits completed, before response construction |
| totalMs | Diagnostic start before the transaction to pre-response completion/error; excludes middleware, HTTP and browser |
| transactionMs | Original transaction-promise wait, including body and resolution |
| bodyExitToResolutionMs | Nested tail within transactionMs; null unless resolution confirmed; not pure COMMIT time |
| sweepMs / wakeMs | Existing awaits, null when not invoked; a resolved wake helper does not prove Event acceptance or worker start |
| revisionBucket | first1, ordinary2–30, middle31–119, long120–200, unknown |

API buckets for new admissions come from the existing reply-state read. Replay
observations describe the returned current state and must not be used as a new
admitted attempt. The existing `[conversation-timing]` development event adds
optional requestId and revisionBucket only after its owned request is read.
Its bucket uses **request.conversationRevision**, the admitted snapshot; later
conversation changes cannot rebucket a stale attempt. Existing fields and their
nested/overlapping phase semantics remain intact. Nondevelopment retains the
legacy field shape. Sink/observer/diagnostic-clock failure cannot change the
business result or swallow its actual error. No diagnostic promise is awaited.

A lost transaction ACK remains unconfirmed even if SQL actually committed;
replay uses the original IDs and business rules. The instrumentation performs no
reconciliation or additional read. API and worker logs may overlap in wall time;
an identifier join does not establish browser paint or exact cross-host clocks.
The frozen initial reader continues to whitelist the legacy worker fields and
strip added fields; it needs a separately reviewed marker/category and internal
UUID-join extension to consume this development event. No collector transport
change is included here.
