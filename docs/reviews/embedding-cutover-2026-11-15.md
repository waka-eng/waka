# Embedding2 cutover preparation

Status: local source candidate for Main review; no publication or live operation.

Native001 stays selected. The prior dev shadow workflow produced434 eligible
vectors and one ineligible cell, but its separate coverage snapshots cannot
certify a future cutover. This change prepares the next bounded operation and
future enrollment. It does not activate a profile or enable the default flag.

## Resulting source behavior

- `embedding2.dev-candidates.v1` is a compiled, immutable limited-dev candidate
  risk choice accepted in Main's source review. Captured policy selects task
  rules: retrieval0.75; chat6, recall8, related5; gardener8 semantic judgments.
  Nearest match and refusal targets still require semantic judgments for
  nonidentical wording. Reading selection does not prune model2 claims by cosine.
  Native constants, ranking and input identities remain unchanged. The small
  agent-authored24-call smoke is neither human calibration nor a population
  quality estimate; opposed scores around0.906/0.928 demonstrate this limitation.
- C0 retains its public closed schema and RO/RR transaction. Its actual verifier
  is factored into a transaction-free core. C1 calls that core inside one explicit
  RC transaction after sorted exclusive advisory, owned-profile SHARE NOWAIT,
  generation UPDATE NOWAIT and control UPDATE NOWAIT barriers. There is no caller
  coverage/policy callback. Exact native-before ownership/type/epoch/G/F/building/
  covered tuple, actual hashes/finite768 geometry/work/tombstone domain and
  all-manifest unresolved0 are mandatory. Pending0 or an old C0 report is not proof.
- C1 installs PG17 `transaction_timeout=5s` as its first callback SQL and verifies
  it before locks. BEGIN/RC setup owns no source locks and is also bounded by
  the dedicated child/idle deadline. An
  unsupported server/setting refuses. Statement1s and lock500ms limits supplement
  rather than replace that whole-transaction limit. No global setting or pool
  expansion occurs. The keyless operator uses a dedicated child capped at6s.
- Lost acknowledgment never retries mutation. A separate closed read operation
  hashes the unchanged historical intent and supplies new read expiry/identity.
  It may inspect an expired original intent; it cannot extend that intent's
  mutation authority. All-after observes the desired transition, not current
  coverage or billing. All-before is `before_or_in_flight`, never proof of rollback
  while an original invocation may execute. Mixed/unexpected tuples hold.
- Empty enrollment first proves zero complete domain under barriers, including
  extra work/vectors/tombstones and unresolved attempts. Only then may missing
  generation/control metadata be initialized, followed by strict core verification.
  `maxCells:1` is a schema ceiling, not paid permission. No inference/wake occurs.
- Password signup, Google signup and missing-human Google recovery use one
  transactional new-human helper. Concurrent recovery serializes on the account;
  an existing winner/login never enrolls. The closed flag
  `WAKA_DEV_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2` is absent/0 off;1 requires actual
  development App/WAKA_STAGE. SST pins it0 on dev API only. Existing22 runtime
  checks remain, plus one boolean proving enrollment stays off/API-only (23 total).
  Groups, retired-agent creation, production and direct-SQL native defaults remain.

## Local evidence

All databases were newly created, positively attested loopback disposable
clusters: actual PG17.11 and PG16.15, pinned postgres-js3.4.9. No owner/shared DB,
provider key, AWS/cloud call or model HTTP was used. Model seams are deterministic
fakes. Node24 was used locally; bundles target Node20 and the future wrapper
requires native Node20. No live Neon/pooler deadline capability is attested.

- Final full API unit:1584 passed,24 existing paid skips. Initial full run retained
  two test-integration failures: explicit PG17 proof accidentally in runtime `src`
  looked orphaned, and a structural source literal named the old model argument.
  Proof moved to `test/pg17`, and literal now pins captured policy. Both gates and
  semantic assertions remain. Initial23-vs22 audit-count assertion retained and
  replaced by the exact prior22 names plus the new flag predicate/negative cases.
- Actual PG16 affected coverage/coordination/reader/C1-refusal run:49 passes including
  the compiled-policy reader cases. The earlier47-pass snapshot is retained. Auth routes:14 passes, including
  real signup, production refusal/rollback, Google new/missing/concurrent recovery
  and preservation of existing native logins. One additional fresh-PG16 case
  proves helper enrollment -> first capture -> normal durable index job/work ->
  one fake request/current completion without a sweep or wake; its initial test
  used the wrong `kind` column and was corrected to canonical `type`. Four focused reader cases cover
  compiled recall, both-policy opposed/locked judgments and actual reading
  cosine1 retention with mandatory review. Counts overlap; do not sum them.
- Explicit PG17 proof:15 cases passed, including stale inactive-vector RC race,
  owned atomic cohort, mid-update SQL rollback, source/delete/type waits, true zero
  enrollment, expired-original/fresh-read handling, still-running original and
  actual COMMIT-wire-drop reconciliation. Two post-relocation smokes and three deadline-first/read cases overlap that
  set; actual PG16 refusal was rechecked after the setter ordering change. CI's existing PG16 suite tests actual unsupported-C1 refusal; it does not
  pretend to run the positive PG17/deadline cases or silently skip their assertions.
- PG17 actually terminated both the hanging-query and synchronous-JS-stall
  sessions and released locks in about5s. The pinned driver's fatal cleanup can
  schedule a write on a null socket; the initial unhandled-parent failure is
  retained. Faults now run in dedicated children, not an exception-swallowing
  handler. One exits abnormally with that driver fault; the stalled child is
  killed at6s. The actual Python child runner also preserved a hard-timeout
  exit-9 at6.006s in an isolated no-SQL/no-AWS check. Closed receipts retain the
  actual child exit/deadline flag. Both fault paths are **UNKNOWN operator outcomes**, with typed timeout flag
  false when only generic closure is observed. Independent writer release and
  unchanged observed epoch are recorded; exit alone is not rollback proof.
- Native matched comparison against exact dev6e8: five real route/worker scenarios
  preserve provider-input/publication digests, call counts, SQL/transaction counts,
  message bounds, ready state and locked wording. Protocol frame counts and SQL
  fingerprints match. Raw bytes differ slightly; variable driver prepared names
  and timestamps were not retained, so exact wire equality/cause is not claimed.
- API types, explicit tools/PG17 types, migration check, diff and closed CLI/Python
  boundary tests pass. Initial harness failures (migration-folder env missing,
  test-only type path resolution, Python archive API mismatch and an outdated
  child-runner mock seam) remain documented;
  they are not runtime/provider defects. No schema/migration/dependency change.

## Actual local C1 measurements

Same synthetic corpus/child stress as C0; max1, preparefalse, real protocol relay,
no injected delay. Cold means a new client/type discovery after seed, not a cold
DB/server. One cold and five warm samples per fixture. No cloud forecast.

| Fixture | Cold exclusive hold through ACK | Worst warm hold | Worst warm writer wait | Result |
|---|---:|---:|---:|---|
| Modest3 cells |18.977ms|10.016ms|10.221ms|activate|
|169 cells |132.269ms|231.298ms|231.706ms|activate|
| Child-heavy169 |114.959ms|112.033ms|112.282ms|byte_limit, atomic rollback|

Warm169:478 core statements,496 actual driver statements including6 controls,
497 conservative budget units,538,154 field-payload bytes,661,244 backend protocol
bytes. No physical-flight/RTT claim. Heavy stress stopped after333 warm driver
statements, with approximately7.92MB backend protocol bytes; no successful field total
is asserted for the refusal. The8MiB field-reservation bound is conservative,
not a wire/heap bound. This valid-but-too-large cohort intentionally refuses;
individual in-bound cells do not imply whole-cohort fit. Local2s warm/3s cold hold
gates passed. Test samples restore only their synthetic metadata between runs;
that is not an operator replay or a live semantic rollback procedure.

## Execution contract and remaining live boundary

Frozen older C0/D1 operators and packets remain separate. The new keyless C1
bundle excludes provider/queue/autodrain dependencies. It attests fixed dev
account/App/worker/stage, independent approved DB URI hash before SQL, honest
native east1 execution and explicit west2 configuration reads. AWS returns full
configuration to CLI memory; projection only narrows stdout. No provider key is
requested. Success requires normal child exit and exact closed receipt/hash;
nonzero/missing/malformed receipt or timeout stays UNKNOWN, never replay.

A future reviewable finite workflow can bind a new2h window once: one fresh
membership check, at most25 planning C0 reads, one unchanged keyless privacy
attestation,25 owned C1 cohort commands and one failure-only read reconciliation
(53 logical invocations, not SQL/API requests). Code must first be deployed and
all three model runtimes accepted at its exact source: old6e8 does not recognize
the new compiled policy. Do not activate against that old runtime.
Historical25 accounts/34 profiles are constraints, not newly current evidence.
Unexpected membership or a new nonempty omitted profile stops/replans. Source
cohorts need complete fresh current coverage; empty15/17 need fresh zero-domain
proof. Any hole/unknown/busy/byte/deadline failure stops remaining mutations.
No automatic D1, R1, wake, cap/expiry refresh, accepted-policy override or fallback.
Exact manifests/hashes/targets and current stage/lock guards still need Main and
the new owner boundary. Publishing source is not that boundary.

Activation enables ordinary query/index/derivation spending under existing
recall10/minute+60/hour, chat20 embedding+answer calls/hour and account60 queue-job
starts/hour. These are count limits, not dollars or a total HTTP ceiling. The
consumed434-call shadow grant funds none of it. Last Main-verified reference text
embedding price was0.20USD/M input tokens, not an invoice/account-rate guarantee;
LLM judgments/answers are additional. Pinned Google AI Studio's published55-day
retention/no prompt training/not-ZDR disclosure and actual restrictive flags must
remain; unset is unknown account policy, never ZDR proof. No topup is proposed.

Future-new-human enrollment remains off. Enabling its dev config/audit requires
separate exact review and ongoing data/spend scope. Direct SQL/unhandled creation
stays native001; all-current-dev enrollment needs fresh stated-time membership
verification. Rollback after new writes requires fresh native001 source/hash/
geometry/anchor coverage and Google availability, a new metadata transition and
separate scope. Do not erase data, retain privacy-invalid vectors, relabel spaces,
reset attempts or claim an instant rollback. Main/prod remain unchanged and the
overall migration remains incomplete.
