# WAKA performance dev delivery

Local implementation and acceptance are ready for review. On 2026-10-05 the
owner authorized opening and merging all milestone PRs and updating the dev
schema where needed. The six PRs are pushed and open; merge/deploy verification
is in progress. Production is excluded. The
[implementation plan](2026-10-05-performance-implementation-plan.md) remains
the full task/gate record.

## Delivery order and PR descriptions

Use one PR per performance milestone, in dependency order. The earlier Review
checkpoint is separate. A stacked PR should target its preceding branch until
that dependency is merged, then be retargeted to dev without unrelated commits.
Verify the remote base immediately before preparing branches; it was
`26a30a39f5d2b700165b63604632ec8f5157736b` at this local handoff.

| Order | Proposed PR title | Local checkpoint | Description and acceptance evidence |
| --- | --- | --- | --- |
| 0 | Simplify Review to one inspiration | `33614ed` | Preserve single-source reflection, confirmed removal, drafts and durable Review navigation. Keep this existing work separate from the performance diff. |
| 1 | Bound Home reads and validate warm snapshots | `c6fee2e` | Remove broad original/room warming; reuse only owned, revision-validated summary snapshots. First sixty seconds fell from 1,555 to 32 requests; warm return does not repeat the archive walk. [Receipt](../craft/evidence/performance/milestone-1.json). |
| 2 | Make Home and Review usable sooner | `5796d4e` | Enable Home/Capture from the first page, preserve complete field geometry, consolidate current Review source reads and retain the session across URL confirmation. Home median 1,910.6 to 400 ms; Review 842 to 359.7 ms with two core opening reads. Draft/error/legacy-route coverage retained. [Receipt](../craft/evidence/performance/milestone-2.json). |
| 3 | Scale owned search and preserve pagination | `beb31b0` | Add nullable policy-tagged text search metadata, synchronous text-write trigger and bounded operator backfill. Preserve bilingual/material matches, exact totals and microsecond cursor order. Twenty query classes have local p95 23.18–46.03 ms versus 416.9–530.21 ms. Requires migration 0067 before new API deployment. [Receipt](../craft/evidence/performance/milestone-3.json). |
| 4 | Streamline personal memory reads | `42d9901` | Preserve literal recall/citations while reducing repeated SQL work. Context median 54.76 ms at pool five and 51.59 ms at pool one; Top of Mind/Principles use ten/four statements. Forty cached retrieval queries retain quality gates, no new model calls. Content-free stage timing added; no generation-policy change. [Receipt](../craft/evidence/performance/milestone-4.json). |
| 5 | Verify performance rollout and readable inputs | Final local milestone 5 commit | Use the shared input-size token, require 0067 in deployment verification, preserve manual browser/model CI checks and document fault/worker controls. Final local web/API suites pass; Home/Review median about 385–387/378–380 ms, warm return worst 199/201 ms. [Receipt](../craft/evidence/performance/milestone-5.json). |

Created PRs, in dependency order: Review [346](https://github.com/waka-eng/waka/pull/346),
Home reads [344](https://github.com/waka-eng/waka/pull/344), readiness
[345](https://github.com/waka-eng/waka/pull/345), search
[347](https://github.com/waka-eng/waka/pull/347), memory readers
[343](https://github.com/waka-eng/waka/pull/343), final acceptance
[348](https://github.com/waka-eng/waka/pull/348). All are attached to this chat.
Dev auto-deploys on a dev push; the owner's merge request covers that consequence.
Record the final deployed revision, not just the PR merge status.

## Before dev deployment

- [x] Confirm push/open-PR authority and the exact milestone diffs.
- [x] Confirm merge/deploy authority separately. Check that the automatic dev
  deployment workflow is still the intended route; no production workflow run.
- [ ] Verify the actual dev API and worker database targets independently from
  the env filename. Record only a sanitized target comparison, no credentials.
- [ ] Apply migration 0067 before deploying the API that reads its columns.
  The migration is additive and does not backfill historical text or call a model.
- [ ] Run `node scripts/verify-memory-schema.mjs` against the verified dev
  target after migration and before API delivery; require the actual migration
  receipt, nullable columns and text-write/source-fencing triggers.
- [ ] Confirm deployed API and web revisions match. A green PR check or
  successful upload alone is not proof of the deployed revision.

## Historical search coverage

Use `pnpm backfill:inspiration-search --help` and the explicit stage/host guards.
Do not load an env default and assume it is safe. Dry-run first, then apply only
with separate database-maintenance authority, for example a 250-row batch with
one batch per initial run. Verify remaining count and resume deliberately.
Busy rows are skipped, so zero updates with nonzero remaining rows is not
completion. Preserve source wording, material/generation revisions and queue
counts. Reads continue using current-text fallback until coverage is ready.

The manual-only `Backfill dev inspiration search` workflow uses the protected
dev secret, compares production's configured endpoint without connecting to it,
and verifies that both actual development Lambda bindings match before any
mutation. It requires the migrated schema, defaults to a dry run and invokes
the existing bounded CLI. Run it only after the final dev deployment completes;
there is no automatic or scheduled backfill and no provider call.

## Deployed acceptance

Measure signed-in cold/warm Home, Capture, Review, Chat and Back on the deployed
revision. Check drafts and recoverable errors, duplicate-save protection,
current citations and account/profile boundaries. Separate actual request
timings from unique-URL inventories. Observe content-free queue, database,
embedding, provider and publication timings before proposing further changes.
Do not create new provider evaluations without announcing and accounting for
them under the existing cumulative USD 5 cap.

Cloud configuration inspection currently returns `AccessDeniedException`;
local pool-one and model-free worker tests do not establish actual Lambda
configuration or provider latency. Real-device CPU, keyboard and microphone
checks remain the explicitly deferred follow-up. Leave unavailable acceptance
items open instead of declaring them proven by viewport tests.

## Recovery

Revert the affected web/API optimization if a verified regression occurs.
Retain additive 0067 columns and trigger unless a separately reviewed migration
is needed; recovery must not delete memory. Pause bounded backfill if target,
revision or queue invariants fail. Keep old/current source fallback and durable
save identities intact. Report failed cases and the final deployed revision.
