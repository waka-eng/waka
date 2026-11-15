# Embedding2 migration operators (prepared, not enabled)

Native `gemini-embedding-001` remains active. This change prepares a distinct
OpenRouter Embedding2 space, source-current readers, versioned work and recovery.
It does not activate a profile, change a key, relabel old vectors or authorize
provider calls, a data migration or production publication.

Embedding2 text input uses `title: none | text: ` for documents and
`task: search result | query: ` for queries, 768 raw values and a hash of exact
formatted UTF8 bytes. There is no `task_type`, `input_type` or normalization
change. Only the fixed Google AI Studio endpoint is eligible; fallback is off.
The native space and its hashes remain separate. Existing edit/delete redaction
still removes invalidated caches; unchanged old rows remain. Rollback needs
fresh native coverage **and** provider availability after subsequent writes.

## Reviewed boundaries

| Mode | Reads / writes | Provider and progress |
| --- | --- | --- |
| `D0` | Read-only aggregate counts/byte totals for at most 32 approved profiles | No words, source IDs or vectors returned; counts do not prove current coverage |
| `D1_prepare` | Bounded inventory, cohort fence and missing work/control metadata | No inference or active-space change; resumptions preserve existing versions |
| `D1` | Reads bounded current source material; writes shadow vectors and paid attempt/progress metadata | Sequential, capped calls; first refusal/uncertain outcome stops the invocation |
| `R1_signal` | Exact account/profile/signal/work-version/epoch recovery metadata | Zero provider HTTP; one explicit worker Event wake after confirmed renewal; ordinary metered queue intent may lead to a later call |

No mode performs cutover. A complete current-hash/geometry inventory under a
writer/cohort barrier, stale-worker drain and a separately accepted threshold
policy are still required. The provisional Embedding2 similarity policy is not
validated and cannot activate profiles. Opposed claims can have high cosine;
existing semantic judgments remain mandatory.

The wrapper attests the current development worker, AWS account/App/stage and an
independently approved DB URI SHA256 before any SQL. AWS returns the full function
configuration to the CLI process; `--query` restricts its stdout projection.
Credentials remain in-process/stdin, with no value in argv, logs or artifacts.
Both wrapper and built Node CLI reject a mismatching target before SQL. Only
`D1` requests the same-stage OpenRouter key. D0/metadata operations do not.

Each manifest fixes account, profiles/epochs, space, DB fingerprint, expiry,
request and formatted-byte ceilings. Up to 1,000 inventory cells, 100 cells per
invocation, 1,000 manifest-wide reservations and 48,000,000 formatted input bytes
are representable; these are upper schema limits, not recommended approvals.
The actual approved manifest should use the smallest useful bounds. Invocation
windows are 20–60 seconds, with another deadline check after reservation and at
the actual HTTP seam. No automatic HTTP retry or fallback is performed by D1.
The once marker is retained for each manifest/invocation pair.

For one source, canonical body input is at most 48,000 UTF8 bytes. The document
prefix is **additional**; the manifest-wide reservation includes it. Raw source
transport has separate 48,000-byte parent, reflection and media ceilings, at most
64 rows of each child kind plus overflow metadata. This is not a promise that
all SQL/wire bytes fit 48,000. Oversized inputs are refused, not truncated or
embedded under an old hash. Real memory is read and sent to the selected provider
in D1; this requires its own explicit data/spending approval. The USD0.20/M input
reference is not an invoice or a hard USD cap; endpoint billing and tokenization
must be checked against the actual numeric receipt.

## Execution recipe for a future approved operation

First build from the exact reviewed immutable source (no network/inference):

```sh
node tools/embeddings/build-shadow-operator.mjs /tmp/REVIEWED_OWNED_OUTPUT
```

The builder emits the self-contained bundle and all input SHA256s. Main must
review the exact source, bundle, wrapper, manifest and their hashes before the
following command is used. This document is not that approval.

```sh
python3 tools/embeddings/shadow_operator.py --execute-reviewed \
  --bundle /tmp/REVIEWED_OWNED_OUTPUT/shadow-index-BUNDLE_SHA.mjs \
  --manifest /PRIVATE/approved-manifest.json --mode D0 \
  --invocation APPROVED_UUID \
  --approved-bundle-sha BUNDLE_SHA \
  --approved-manifest-sha MANIFEST_SHA \
  --approved-operator-sha WRAPPER_SHA
```

Use native authenticated us-west-2 CloudShell with preinstalled AWS CLI and Node20.
The private manifest must be mode0600, canonical compact JSON with the reviewed
schema order. Do not pass DB URLs or keys on the command line. Change only to the
individually approved mode/invocation; no automatic mode chaining is provided.
The wrapper's hardcoded development identity refuses production. A new target
or region requires separate source/identity review, not a substituted credential.

A metadata-only `R1_signal` manifest adds exactly one `signalRecovery` object:
`{ "profileId": "APPROVED_UUID", "signalId": "APPROVED_UUID", "workVersion": "EXPECTED_DECIMAL" }`.
Its sole profile/epoch must match that target. Other modes refuse this field.
The callable implementation is `renewEmbeddingSignalFromManifest`; the lower
SQL-only helper is `renewKnownFailedSignalEmbedding`. The wrapper uses the same
hash/once/target guards and receives no provider key. The Node helper performs
SQL only; the wrapper then sends one Event wake to the already-attested dev
worker after a matching bundle/manifest/mode receipt confirms one-cell renewal
and the child exits successfully. Child autodrain is explicitly disabled. This
ordinary worker wake can drain other eligible backlog under existing budgets;
it does not guarantee one downstream model call and is not covered by the D1
input allowance. There is no local app autodrain. A
failed/unknown wake leaves confirmed metadata intact and is never retried
automatically. Approving this recovery
must include the resulting ordinary queue intent. There is no signal Retry UI
and no automatic renewal by status reads or queue retries.

## Recovery truth table

| Observed state | Callable recovery | What it does not imply |
| --- | --- | --- |
| Definite HTTP failure; normal automatic transient budget remains | Existing normal queue retry, at most three dispatches on that work/request group | No refunded reservation or infinite retry |
| Definite HTTP failure exhausted/refused on current canonical work | Authenticated human `POST /api/inspirations/:id/processing/retry` with optional owned `receiptId`; exact signal `R1_signal` above | Fresh version and ordinary metered intent, not a row reset; repeated clicks cannot renew an unattempted fresh version |
| Reserved/in flight | Existing hold/check path | No second dispatch while the first may be running |
| Unknown dispatch, including changed words/request/manifest | Held; separately review exact outcome and any future paid recovery | A new hash, manifest, purpose or queue request cannot bypass the hold |
| Received result retained by the current invocation | Up to two SQL-only commit attempts and exact current-result reconciliation | No second HTTP; a receipt alone is not a vector/source proof |
| Received result lost before confirmed publication | Held pending exact current vector/decision proof or a separate explicit recovery decision | Restarting the queue or editing wording cannot recreate the lost result for free |
| Physical publication committed but acknowledgment lost | Exact source/hash/space/epoch/vector or decision reconciliation, zero HTTP | An arbitrary current vector does not erase another uncertain paid attempt |
| Source changed/deleted/excluded or policy/claim stale | Reject publication; settle ineligibility where appropriate | Stale vectors are not retained to make rollback look complete |

Unresolved identity includes source, space, input scope and closed dispatch family
(`index` or `discovery`); live versus migration is a purpose, not a family.
New source words may remain held behind an old unknown dispatch. Other current
memory remains usable. A bounded discovery invocation may continue its own next
member while it actually retains earlier received results in memory; a restarted
invocation cannot substitute ledger receipts for those results.

GET/poll does not renew work. Existing `canRetry` is false for unresolved embedding
work and for key-scoped sessions. POST independently enforces human-session and
owned/write capability, including read-only credential denial. No new public
processing/recall state enum or client release is required. Existing packed MCP
0.2.0 sees an unavailable error rather than a false empty result when required
current coverage is incomplete.

## Acceptance and remaining gates

Local PG17/fake-provider tests cover source edits/deletion/exclusion, tenant and
claim/epoch fences, two-client same-source reservations, different manifests,
unknown outcomes, retained-result lock contention, lost COMMIT acknowledgments,
known-failure human recovery, strict geometry and released-client error handling.
These are not live migration/provider/coverage or user connection evidence.
Native matched route fixtures preserve prompt/publication semantic digests and
call/statement/protocol counts, with nonzero added proof bytes. Child-heavy
presence proofs use conservative lexical fallback. Queue fairness still permits
one preceding index slot and retains the existing 60-start account budget; it is
not a guarantee of zero chat delay. No priority, pool or polling change is made.

Before real migration: approve D0/data scope; inspect actual inventory; approve a
small D1 cost/content manifest; retain its receipt and unresolved markers; prove
complete current coverage and writer/in-flight barriers; separately calibrate
thresholds and review the exact cutover. Before rollback: prove current native
coverage and availability, preserve additive schema/attempt history, and never
reset or erase real memory as recovery. Current Google availability is not fixed
by this preparation. All earlier synthetic canary allowances are consumed.
