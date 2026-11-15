# Embedding2 index preparation, 2026-11-14

The owner selected stable `google/gemini-embedding-2` through OpenRouter. This
candidate prepares its separate index, runtime readers/writers and bounded
migration/recovery operators. **Native `gemini-embedding-001` remains active by
default.** No real data backfill, route activation, key change or production
publication is included. Google audio and HEIC remain separate existing routes.

Production synchronizes GitHub `GEMINI_API_KEY` into stage SST `GeminiApiKey`.
Development uses its existing stage SST value without that workflow sync. This
source inventory identifies credential slots, not a Google account/project or
current provider availability. No credential values or owner memory are present
in this report.

## Space, policy and currentness

Model001 and model2 are incompatible spaces. Existing unique vector keys permit
side-by-side rows; no old vector is relabeled or normalized. Model2 fixes 768 raw
values, exact query/document prefixes and SHA256 of formatted UTF8 input. There
is no task_type/input_type mapping. Only the exact broker stable model identifier
and observed bare stable identifier are accepted; preview/001/arbitrary aliases
are refused. Google AI Studio is the sole pinned endpoint, with no fallback and
existing restrictive privacy settings preserved.

The six construction paths share the policy-aware factory. Policy metadata rides
existing source/owner/generation queries and is rechecked at publication. Missing
control rows preserve native epoch0 hashes, prompt identity and selected space.
Building a shadow index does not invalidate a native reply.

| Writer / reader | Current-space boundary |
| --- | --- |
| Inspiration canonical indexing | Owned source/ordered reflection/effective attachment material, exact formatted hash, scope, policy/epoch and work version |
| Capture and review discovery | Current material/lineage, generation, job request/claim and durable candidate-group reservations |
| Signal reindex | Current exact statement, owner, policy/epoch and geometry, including locked wording |
| Recall query | Only after eligible current compatible vectors exist; account query budget and after-HTTP source/support proof |
| Chat query | One selected cohort space; mixed legacy `both` remains lexical, with both owners fenced at publication |
| Related inspirations | Central model/dimensions/hash selection plus canonical proof for the bounded selected sources |
| Match targets / dismissal anchors | Current selected-space vectors are required; missing anchors hold discovery instead of permitting a new duplicate |
| Gardener / reading selection | Current statement hash/model/dimensions; meaning judges and human locks retained |

Model2 cosine is a retrieval signal, not agreement. The small synthetic corpus
included opposed pairs above0.90. Nonidentical match/refusal decisions therefore
retain semantic judgment; model2 reading selection does not discard claims using
cosine-only diversity. Its separate provisional numeric policy is **unvalidated**
and cannot activate profiles. No001 threshold is silently transferred.

## Progress, uncertainty and recovery

Draft migration0088 adds three operational tables, a version sequence, canonical
mutation fences/triggers and one bounded normal `index_embedding` job kind. It
changes no memory layer or vector column. A source's requested/completed versions
prevent one completion from clearing another edit. Inactive shadow vectors do not
advance active generation; active vector writes/cutover still do. Child ID edits
are included because tied timestamps can change canonical ordering.

Canonical indexing and generated discovery have distinct closed dispatch
families. An unresolved source/space/scope/family remains held across changed
hashes, material, request, manifest or live-versus-migration purpose. A bounded
same-invocation discovery group may continue only while it retains earlier
received results. A restarted invocation cannot treat ledger rows as vectors.

Two actual disposable-PG regressions initially dispatched twice after changed
source wording or combined new request/new wording; both now dispatch once.
The separate different-manifest race is rechecked under the existing work lock
with explicit READ COMMITTED statement snapshots. No database lock spans HTTP.
A received result survives bounded SQL-only lock/serialization retry; an uncertain
COMMIT is reconciled against exact current source/hash/space/epoch/vector, without
provider replay. Unknown dispatch and received-without-publication remain distinct.

Existing human processing Retry can renew a definite HTTP-failed current work
version, retaining attempt history and ordinary metered queue intent. Two clicks
coalesce; polling and background retries never renew versions. Backend human and
owner/write gates refuse key-scoped/read-only/foreign attempts independently of
UI visibility. Existing `canRetry` excludes unresolved embedding work using an
EXISTS projection on the existing status SQL. Signals have a bounded privileged
metadata-only `R1_signal` operator, not a new public tool or UI. Exact callable
paths and the recovery truth table are in the
[operator contract](../../tools/embeddings/README.md).

Unchanged old rows are retained. Existing source edit/delete privacy redaction
continues to remove invalidated caches. Rollback after subsequent writes requires
fresh native coverage **and** native provider availability; it is not an instant
semantic reversal. Other usable current memory is not globally hidden because an
unrelated source is pending or held.

## Measured overhead and limits

Five matched native route fixtures used the exact old dev runtime source against
the same new synthetic schema: first plain, first/long120 Why3 with successful
query lookup, and first/long120 Why3 with failed lookup. Prompt and publication
semantic digests, provider call counts, application statements and dependent
protocol boundary counts matched. Volatile timestamps were excluded from the
publication digest; whole response byte identity is not claimed. No owner data,
paid calls, network RTT simulation or cloud latency measurement was involved.

| Native prepare fixture | Application statements before / after | Backend bytes before / after |
| --- | --- | --- |
| First plain | 16 / 16 | 3,543 / 3,968 |
| First Why3 indexed | 21 / 21 | 6,283 / 8,955 |
| Long120 Why3 indexed | 22 / 22 | 32,807 / 35,488 |

The strict current-index presence proof has a real byte cost. A 24-source,
three-children-per-kind synthetic fixture returned174,602 warm backend bytes
versus72 for the old existence-only check. A 17-child heavy fixture conservatively
fell back to lexical context at59,402 bytes instead of the earlier unguarded
3,483,434 bytes. Both checks still use one SQL statement; that does not mean zero
cost. Character guards are not total UTF8/wire ceilings. No cloud/chat speedup is
inferred from these figures.

An actual pool-one prepared-driver index fixture with three reflections measured
29 application statements plus five transaction commands on first indexing,
59 dependent protocol boundaries and6,973 backend bytes, with one fake call.
The subsequent current-cache proof used12 statements plus two controls,
15 boundaries and6,940 bytes, with no call. Statement-shape preparation and
connection/type warm-up are distinguished; these are not physical RTTs or a
prediction for Neon/Lambda.

The normal queue retained its60-start account limit and kind fairness. With100
index jobs, a synthetic chat was claimed second, behind one index slot. A40ms
controlled preceding delay remained about40ms; there is no zero-delay guarantee
or priority/pool change. Bulk D1 work stays outside that queue.

## Verification and remaining release gates

- Full API unit gate: **1,543 passed**,24 existing paid-evaluation skips.
- Final focused real PG17 gate: **196 passed across12 files**. Includes actual
  dispatcher, source/epoch/tenant/claim/Stop, native concurrency, locks, ledger,
  deleted/edited material, released packed-client partial-coverage errors,
  human recovery, budget and rollback cases. Provider/LLM transports were fake.
- API types and migration consistency passed. The fixture was explicitly
  attested PostgreSQL17.11 on disposable loopback, not an env-file assumption.
- Failed receipts remain: unknown-dispatch double-call baselines; the prior
  cross-manifest race; vocabulary naming violations; a structural test's old
  suppression-call literal; earlier fixture/transport construction mistakes.
  The structural assertion now names the model argument while retaining refusal
  ordering. No runtime safety assertion was removed to pass a gate.
- Historical model2 capability run:24/24 accepted and8/8 fixed retrieval checks,
 527 input tokens and reportedUSD0.0001054, not an invoice. Earlier two single
  calls stopped on strict response rejection; only the second established the
  stable string-form mismatch. All approvals are consumed. These agent-authored,
  agent-reviewed synthetic expectations are not independent human ground truth,
  calibrated thresholds or broad product quality evidence.

The earlier001 parity proposal was withdrawn and never executed. Current work is
model2 migration preparation. The prepared D0/D1/R1 operators require exact
source/target/data/spending review before execution. Full current coverage,
writer/in-flight barriers, threshold calibration and exact cutover remain held.
The Google availability issue is not repaired by this code. No backfill, provider
account policy change, environment activation or user-connection proof is claimed.
