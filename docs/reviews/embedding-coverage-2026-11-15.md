# Read-only current embedding coverage preparation

C0 adds an owned, bounded verifier before any real-memory Embedding2 rollout.
It checks canonical current personal/public captures and all signal anchors,
actual formatted hashes,768 finite values with finite nonzero norm and matching
work versions/outcomes. It includes stale/tombstoned work and extra target-space
vectors. Zero pending work, a vector count or a paid receipt cannot substitute.

The operation is explicit READ ONLY REPEATABLE READ. A concurrent later commit
does not invalidate the truth of its older snapshot, but that witness is not an
activation certificate. An actual local inactive2 vector edit left generation
unchanged: older C0 snapshot complete, new snapshot incomplete. Future activation
must use fresh post-fence proofs, not inherited stale RR or cached C0 output.

Always-present `unresolvedAttempts` counts all owned target-space reserved,
received and unknown live/migration attempts, including deleted-source records.
Optional exact-manifest reconciliation is separately scoped and refuses foreign
manifests without returning their counts. Source coverage can be complete while
an old request remains unknown. No status is cleared and no invoice/provider
certainty or activation permission is claimed. Future cutover must require zero
global unresolved attempts as well as current coverage/policy/frontier proof.

The canonical reader was factored without changing native canonical-v1 words,
normalization, hashes, provider behavior or existing native query path. C0's
account-bound execute branch contains server field/row guards. The sibling entry
has no provider/queue/activation capability and loads no env files. Original paid
bundle/operator, all schema/SST/workflow/dependency files and active native001
selection remain unchanged.

## Local evidence

- API and tool-entry types pass. 1,570 API unit cases pass; 24 existing paid
  cases remain skipped.
- 22 targeted real PostgreSQL17 cases pass:17 C0 plus5 existing shadow-operator
  cases. One later focused SQL-error privacy case also passes (23 distinct PG
  cases total); these overlap earlier receipts and are not added to them.
- Six offline Python wrapper cases cover source/target/region/error/privacy seams;
  the east-region assertion correction was rechecked in its focused case. CLI
  source tests actually build/run refusal paths and private0600/no-overwrite
  filesystem publication. Fake seams are explicitly documented; no live identity
  or Node20 execution is claimed from them.
- No model HTTP, shared data, owner content or AWS read occurred. A positively
  attested disposable PostgreSQL17.11 and pinned postgres-js3.4.9/max1 were used.
  SQL parameter values/protocol payloads were not saved by the measurement proxy.

Actual protocol proxy, unprepared, no latency injection. Fields/signals/children
are synthetic. The169-cell fixture matches historical61 inspirations+15 public
scopes+93 signals; its missing real signal lengths are not invented as owner data.

| Fixture | Cold / warm local ms | Field-payload bytes | Actual SQL cold / warm | Client Q/H/S boundaries cold / warm |
| --- | ---: | ---: | ---: | ---: |
| Modest3 cells |15.4 /5.8 |9,220 |16 /15 |28 /27 |
|169 cells |119.2 /107.6 |536,390 |482 /481 |960 /959 |
| Valid child-heavy169 stress |106.1 /93.1; **byte_limit** | No successful aggregate result |320 /319 before refusal |636 /635 |

The169 successful reads contain478 application statements plus3 transaction
commands and one cold type-catalog query. Backend protocol bytes are667,752 cold/
657,792 warm. Heavy stress was refused after about7.92/7.91MB backend protocol
traffic; no subset complete or cap expansion. This verifier intentionally refuses
that valid-but-too-large cohort. Do not claim every individually valid cell means
the whole cohort fits. Maximum observed DataRow was47,996 bytes; maximum observed
response group through ReadyForQuery was51,300. These measurements support the
fixed guards, not a general heap/wire or physical-flight bound.

The8MiB field accounting cap,512KiB pre-query reservation and60-second limit remain
unchanged. Timings are individual local runs, not p50/p95, Neon/Lambda performance
or production acceptance. Historical fixed-query regional references favored
east execution near the existing east DB, but cannot predict this verifier's
runtime or be multiplied by478 as an actual timing claim. C0 therefore requires
native east1 execution while attesting the existing west2 runtime explicitly.
No database/application migration or production change is part of that placement.

## Remaining gates

This is preparation only. No live C0, backfill, new spending, provider test or
cutover was performed. Model2 policy0.80 remains provisional and activation
default-held. Fresh membership/scope, endpoint privacy eligibility and real-memory
approval are still required. Future C1, empty/future-profile enrollment and lost
cutover-ACK tuple reconciliation are separate unimplemented reviewed designs.
