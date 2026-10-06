# WAKA beta readiness milestones

Status: in progress (2026-10-05), milestones 1 and 3 passed locally; milestone 2 technically checked, human comprehension pending; milestone 4 remains open. No current-goal deployment.
Branch: `codex/beta-readiness-m1-m4`, based on deployed dev `56a2694`.

## Objective

Implement all of milestones 1 through 4 from the comprehensive app review:
authentication and dependency safety, core-loop UX clarity, AI quality and
historical context, and performance and operational reliability. Preserve the
current visual feel, private ownership, human wording locks, source validation,
and versioning. Keep native release and milestone 5 out of this goal.

## Milestone 1 Authentication safety and dependency fixes

Prevent silent bcrypt truncation for new passwords with byte-aware validation,
while retaining login compatibility with existing hashes and passwords. Patch
the affected Hono dependency and verify authentication/authorization behavior.
Keep existing-account recovery limitations explicit; do not silently change
stored hashes or lock existing users out.

Gate: ASCII and Unicode inputs through the 72-byte boundary have regression
coverage; oversized signup is refused before database access or hashing; the
hashing helper cannot create a truncated new password; existing hashes still
authenticate. Dependency audit and applicable route tests confirm the patch.

## Milestone 2 Core loop UX clarity

Make Capture, Principles, Review, chat, and sharing easy to find without adding
public state categories. Give Principles a persistent clear entry/count or
preview; distinguish evidence and actions; clarify room-only capture sharing;
explain Review selection and Next without implying deletion. Use readable
action labels with preserved input sizes and touch targets. Make source-based
chat continuation consistent across old and new replies and conversation
titles recognizable by their substantive topic.

Gate: desktop and narrow built-browser journeys cover all five destinations,
Back/deep links, keyboard/focus, drafts, audience defaults, and existing data.
New-user comprehension must be observed without guidance; owner acceptance
alone or automated tests do not establish that human gate. Record the actual
evidence and keep that gate open when participants are unavailable.

## Milestone 3 AI quality and evolution

Evaluate the complete fixed 24-scenario generation matrix on DeepSeek V4.1
Flash, retaining the known compound-guide and locale-grounding failures in the
rubric. Add bounded, dated, owned historical context for questions about how
thinking changed, with meaningful-version comparison and explicit abstention
when evidence is insufficient. Preserve correction, deletion, source freshness,
human wording, and account/group separation. Validate usefulness and specificity
alongside structural output and citation checks; do not retune weights blindly.

Gate: the full fixed matrix meets its existing >=90% qualitative bar, all
critical safety cases pass, and history-aware chat uses actual earlier/current
records without invented dates, missing-source revival, or foreign history.
Model requests must declare and verify their expected model and budget.

## Milestone 4 Performance and operational reliability

Benchmark long conversation reads before changing them, then batch reference
validation and add bounded history delivery where required. Measure deployed
queue, retrieval/embedding, provider, and publication delays separately, including
warm/cold and concurrent behavior. Add monitored bounded recovery for overdue
runnable jobs, preserving durable idempotency and intended cadence/budget waits.
Make model usage/spending observable and establish explicit per-environment
cost controls and alerts. Verify provider-data policies and trusted origin/source
configuration rather than inferring them from an env filename or default.

Gate: long-thread measurements and regressions demonstrate reduced read work
without stale/foreign citation access or lost messages; deployed measurements
distinguish stages; overdue runnable work recovers without duplicate model work;
usage/spend visibility and safeguards are exercised. Existing performance gates
and ownership/material-revision invariants remain satisfied. Human or cloud
access requirements remain open until authoritative verification is available.

## Verification and budget

Use targeted checks from AGENTS.md and explicit disposable loopback databases
for SQL/UI tests. Never use the env-file database default for mutations. No real
account content in paid evaluations. Use the approved cumulative USD 5 test
budget: allocation before this goal is USD 1.5833779064, leaving USD 3.4166220936.
Announce each paid batch and retain usage and failed/unknown outcomes.

Implement and commit milestones separately. Publishing, deployment, new
security-sensitive access, or external coordination requires applicable user
authority. Do not mark all four complete from a narrower unit/smoke check.

## Log

### Start on 2026 10 05

Confirmed clean local dev at `56a2694` and a matching remote head. The previous
review yielded progress: a synthetic check proved bcrypt ignores different
suffixes after 72 bytes; production dependency audit reported four moderate
Hono advisories, with no high/critical findings reported. The new branch keeps
older stashes and deployed data untouched. Milestone 1 starts with defect-first
ASCII/Unicode and legacy-login regression cases.

### Milestone 1 gate on 2026 10 05

Criterion: no silent truncation for new passwords, compatible legacy login,
patched production dependency, and authentication regression checks.

The defect-first boundary run passed 6 and failed 8 of 14 tests. Oversized
signup reached the refusing database spy (500 rather than 400); hashing resolved
instead of rejecting the four oversized ASCII/Unicode inputs. After adding one
UTF-8 byte policy to signup and the hashing helper, all 14 boundary cases pass.
Legacy verification deliberately remains unchanged, including old long inputs;
stored password hashes were not migrated or rewritten.

Installed Hono changed from 4.13.0 to 4.13.7, including its node-server peer.
The production dependency audit changed from four moderate advisories to zero
reported advisories across 105 production dependencies. The lockfile diff changes
only the Hono version/integrity and its peer binding. This is not a claim about
unscanned application logic or the entire development-tool dependency graph.

Verification: 835 API unit tests passed, three opt-in paid benches skipped;
49 targeted auth/boundary tests passed; seven real signup/login SQL cases passed
on explicit loopback `waka_capture_a03_test`. SQL cases cover accepted 72-byte
ASCII/Korean/emoji passwords, rejected oversized registration with no identity
or session rows, and a legacy long-password login without rewriting its hash.
API typecheck, diff check, and all three goal-index checks passed.

Retained repair evidence: a test cleanup accidentally returned a spy and was
corrected to a void hook; the new response assertion needed an explicit JSON
type; a package-version diagnostic used an unexported package subpath and was
replaced by reading the installed package metadata. These were not failures
of the boundary policy. No model calls, remote data changes, schema changes,
push or deployment occurred. Verdict: milestone 1 passes locally.

### Milestone 2 baseline on 2026 10 05

Started a current production-build fixture with 25 synthetic inspirations,
three Principles and two synthetic reading references. Provider networking and
autodrain are disabled; no real account content is used. The fresh desktop Home
baseline is retained at `work/performance/beta-m2-baseline/home.png`. Its
Principles shortcut has a 44-pixel hit height and 15-pixel uppercase label,
but no count; the destination is at the top edge rather than alongside the
reading. Existing Review and chat activity cards remain distinct.

Asked whether first-time participants can be arranged for the comprehension
gate; the request is pending. That check is not replaced by these measurements.
The owned fixture remains live for the next UI implementation and verification.

### Milestone 2 technical checkpoint on 2026 10 05

Implemented a visible counted Principles shortcut without another Home action
row; unknown data does not appear as zero. Reading evidence/actions use plain
names, Principle action labels use readable type, Capture offers Only me and
Share with rooms, and Review states that Next keeps the inspiration. Share-card
loading now names the Principle instead of an inspiration.

Chat previews, including older references and Principle/inspiration references,
offer Discuss this through the same owned-source revalidation and durable send
path. Existing draft, double-click, cancellation and stale/foreign-source guards
remain. Empty reference groups no longer render after conversion to cards.
Sidebar previews use the first substantive human topic rather than a generic
starter; one provider-free policy governs the local update and bilingual starter
list, with a drift test and scoped SQL list selection. No title generation call,
stored title, new schema, or assistant-generated label was added.

Verification: 771 web tests, 843 API unit tests, 12 conversation SQL cases,
API/web/admin types, production web build and diff check pass. Built browser
checks at desktop/320 pixels covered Capture/draft return, Review/Next return,
Principles, the selected share-card route/preview, and chat. Review Next left
all 25 originals stored. The old-reference action made one successful message
POST and stored the verified second reading once; SQL confirmed zero dispatched
conversation model requests. Seeded assistant replies are UI fixtures, not AI
quality evidence. Detailed receipts are in
`docs/craft/evidence/2026-10-05-beta-readiness-m2.json`.

Retained failures: old-word test selectors were repaired without dropping
behavior assertions; a duplicate CSS rule was consolidated after the structure
gate failed; formatting the count required formatMessage, not t. Concurrent
full checks caused two 5-second real bcrypt timeouts; production cost and all
assertions were retained, the affected test timeout is bounded at 15 seconds,
and the full API rerun passed. No paid provider calls or remote writes occurred.

The technical work is ready, but no first-time participants have been observed.
The pending user question remains unanswered. The milestone 2 human gate and
the all-four-milestone objective are not complete; milestones 3 and 4 are not
silently claimed by this checkpoint.

Both owned fixture schemas were removed after normal shutdown and checked
absent; the baseline/current screenshots remain. Temporary test tabs were
closed and the viewport override reset.

### Milestone 3 gate on 2026 10 05

Criterion: the existing fixed 24-scenario generation matrix clears its 90
percent qualitative bar and critical safety cases; historical chat uses real
owned earlier/current records without invented dates or missing-source revival.

Baseline: 23/24 structural and 22/24 qualitative. The single-origin case
invented attendance ("A workshop you attended"), and repeated same-day choices
failed to produce an initial guide. Candidate: 24/24 structural and qualitative,
including the retained compound-guide and locale cases. Selected recent focus
now leads unless human-kept words already lead. Capture dates no longer imply
experience dates or a calendar wait. Weights, thresholds and cadence did not
change. Final-code provider-free replay also passes all 24 structural cases;
it reuses the recorded candidate outputs, not another live sample.

Historical retrieval adds at most two earlier meaningful versions to up to
three live entries, within the existing context allowance. No-change copies,
identical current words, unsupported machine history, dismissed entries and
other profiles are excluded. New reading proofs bind dates/version/full words
without breaking old text-only citations. Deliberate historical citations stay
usable; a formerly current source becoming historical still marks its old
reply changed. SQL verifies deletion withdrawal, supersession, proof changes
and foreign exclusion. Existing JSON reference metadata gains an optional
historical flag; no SQL migration is required.

The final 24-case chat matrix has 24 structural and 23 qualitative passes,
with no critical safety failure. The retained miss describes kept wording as
if it had a separate possible-guide label. All four real-reader history cases
pass; comparison replies still sound more cautious than ideal about examples
under kept words. These are bounded synthetic results, not an independent user
study or a claim to inspect the whole archive. The complete per-case review,
failed examples and receipts are in
`docs/craft/evidence/2026-10-05-beta-readiness-m3.json`.

Retained intermediate failures include duplicated/bundled questions, old
Principle citations after corrections, a considered class treated as decided,
an assumed disappointing project, schema labels in prose and a false claim
that only editing could first create a Principle. Corrections now omit saved
sources unless an explicit comparison is requested, through both the provider
builder and strict citation parser. A shorter prompt keeps direct-answer and
hypothetical behavior without silent memory edits. Raw evaluation snapshots
remain unchanged; the separate review receipt records their verdicts.

Verification: 863 API unit tests, 780 web tests, 45 conversation/history SQL
cases, API/web/admin types, migration check and production build pass. Built
narrow cards show Earlier reading and the record date, including accessible
labels. Current and old-reference previews, source reopening, and the selected
follow-up preserve the date and exact words. The fixture stored one follow-up
and dispatched zero provider requests. Test-only history setup is opt-in.
An initial mock-header seam check and a wrong diagnostic SQL column were
corrected without weakening behavior checks.

Final consistency review aligned the worker's selected-context receipt with
the provider/decoder correction rule. A plain correction now records no saved
sources and buys no query embedding; an explicit comparison still retrieves
the unchanged owned Principle. The new SQL case initially reused the fixture's
earlier follow-up, which the strict parser correctly refused; supplying distinct
controlled replies and asserting ready publication fixed the test. No live
prompt changed in this policy extraction. The browser fixture was shut down
normally and its exact schema checked absent; temporary tabs and viewport
overrides were cleaned up, with screenshots retained.

All paid attempts, including intermediate failures, total 256 calls and
USD 0.049843195 for this milestone. Cumulative allocation is USD 1.6332211014
of USD 5, leaving USD 3.3667788986; every call returned cost metadata. Provider
evaluations contain synthetic inputs only. No remote data, production, push
or deployment changed. Verdict: milestone 3 passes its local fixed-matrix gate.
Milestone 2 human comprehension and milestone 4 remain open.

### Milestone 4 long conversation read checkpoint on 2026 10 05

Criterion for this slice: reduce repeated source-validation work while retaining
all messages, exact proof validation, ownership and earlier/current status.
Measure before changing the reader; keep the broader milestone open.

The initial model-free baseline at 20 samples uses 339 SQL statements and
299.3 ms median for a repeated-source 200-message thread; varied sources use
205 statements and 212.07 ms. Source validation was repeated per assistant
message. The new reader deduplicates identities within the read, loads them in
three-identity chunks and validates every requested proof independently. Legacy
and modern inspiration proofs can coexist; large earlier words keep their
full original excerpt allowance. No cache survives the request.

Standalone candidate timings varied, including a small varied-source regression;
the first candidate also overlapped targeted SQL tests. Diagnostic plans showed
sub-millisecond planning and no JIT, not an identified cause of that variation.
A matched 20-sample comparison alternated baseline/candidate order on the same
owned schema. The temporary baseline projection was copied from `da74232` and
used the same serving predicates. It was removed, along with its comparison
switch, after selection. All six normalized output digests match.

| Sources | Messages | Median before and after ms | Statements before and after |
| --- | --- | --- | --- |
| Repeated | 20 | 30.75 → 6.54 | 39 → 11 |
| Repeated | 100 | 145.91 → 6.75 | 172 → 11 |
| Repeated | 200 | 297.83 → 7.09 | 339 → 11 |
| Varied | 20 | 20.84 → 11.87 | 25 → 15 |
| Varied | 100 | 105.68 → 12.33 | 105 → 15 |
| Varied | 200 | 209.45 → 13.68 | 205 → 15 |

Matched p95 at 200 messages is 310.89 → 8.35 ms repeated and
217.51 → 19.46 ms varied. This is one local read-only transaction at pool one,
not HTTP/auth, cold-start, concurrent-user, worst-case body or cloud latency.
All benchmark schemas were cleaned and no provider was called. Foreign/changed
proofs are refused; legacy and historical proofs remain available. SQL equality
tests additionally compare complete source objects and invalidate proofs after
words change beyond the visible excerpt. Bounds tests refuse oversized groups
before SQL. Initial test errors incorrectly expected six long rows inside one
8,000-character context and spread nested test-table arrays; the original cap
and actual boundary assertions were retained when correcting those fixtures.

Verification: 866 API unit tests, 46 SQL cases, API/performance types,
migration and diff checks pass. The matched receipt is
`work/performance/long-conversation-matched-1791256473635.json`.
The full milestone is not complete: paging remains conditional on large-body
or deployed evidence; overdue recovery, usage/cost controls, provider/origin
verification and deployed stage measurements are still required. This host has
no AWS CLI or local SST output receipt. Dev PR/deployment authority was requested
separately and is pending; no remote writes or deployment occurred.

### Milestone 4 recovery and usage checkpoint on 2026 10 05

Implemented a dev-only fifteen-minute recovery event on the existing worker,
with a five-minute overdue grace and at most five claims in one pass. The same
eligibility predicate serves observation, budget peek and claim. Normal
immediate wake-ups and the daily sweep remain. Active leases, intentional
future waits and unsupported future job types are excluded; attempt-exhausted
leases are reported, not restarted. This adds up to 96 idle metadata reads per
day and custom metric/alarm costs; deployment is not authorized by the code.

Raw JSON CloudWatch metrics expose overdue count, age, exhausted leases and a
heartbeat. Dev console alarms include missing recovery checks; an explicit SNS
topic is required for notifications. The implementation follows the documented
[SST Cron event contract](https://sst.dev/docs/component/aws/cron/) and
[CloudWatch embedded metric format](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Embedded_Metric_Format_Specification.html).
Live metric extraction, alarms and delivery have not been verified.

OpenRouter and Gemini transports now emit content-free numeric usage metadata.
Returned OpenRouter cost is recorded even when output is unusable; failures
retain an attempt and unknown billing rather than a zero-cost assumption.
Gemini costs remain unknown despite available token counts. Stage/provider
dimensions are bounded; operation labels are closed and not dimensions. No
prompts, responses, vectors, credentials or account IDs are logged by these
new metrics. This observes spend, not a hard-dollar enforcement ledger.

Verification: 883 API unit tests and 38 targeted queue/conversation SQL cases
pass, along with API types, migration and diff checks. Real SQL proves concurrent
claims process one durable job once, budget-capped work keeps its identity and
waits, recovery skips newly due jobs, and normal wakes still process them.
Existing conversation tests retain the ambiguous-dispatch refusal. Initial
type inference, raw-SQL timestamp parsing and mock-table corrections were fixed
without weakening those checks. No paid model request or remote data write was
made; cumulative evaluation allocation remains USD 1.6332211014 of USD 5.

A read-only check of the approved local evaluation key reports a USD 10 monthly
OpenRouter limit, excluding BYOK usage. This verifies only that key, not deployed
stage keys, Gemini budgets or separate dev/production limits. Budget amounts and
reset periods, alert destination and dev PR/deploy approval were requested and
remain pending. First-time-user comprehension, actual deployed stage timings,
provider-data/origin verification and exercised cost safeguards are still open.
This checkpoint is progress, not completion of milestone 4 or the full goal.

### Milestone 4 configuration checkpoint on 2026 10 05

Runtime and provider-key checks are implemented without defaulting budgets or
printing secrets. Runtime input requires separate API/worker environment
objects, exact stage HTTPS origins, safe cookies, stage/model tags and no
fixture/private-host allowlist. Parsed equivalent origins remain equivalent.
The report deliberately leaves proxy topology, isolation, privacy and money
limits unverified. SST currently declares no trusted proxy-hop count; choosing
one without attesting the real edge/direct-access topology would be unsafe.

`verify-model-key-limit.mjs` requires explicit approved amount/reset flags before
its read-only provider lookup. It rejects absent or broader limits, wrong reset
periods and excluded BYOK usage; it does not claim to protect Gemini or prove
separate stage keys. Native/network errors use an exact safe-message allowlist,
not a prefix that could echo credentials. The default invocation intentionally
refuses without a chosen budget. No account policy, key or spending limit changed.

OpenRouter's transport can opt into collection denial and zero retention via
`WAKA_OPENROUTER_DATA_COLLECTION=deny` and `WAKA_OPENROUTER_REQUIRE_ZDR=1`.
Unset/zero overrides do not send a weaker policy, invalid values fail before
dispatch, and an unavailable restricted route fails without fallback. Controls
are not enabled on deployed stages. These follow OpenRouter's
[provider-policy controls](https://openrouter.ai/docs/guides/privacy/provider-logging)
and [retention routing contract](https://openrouter.ai/docs/guides/features/zdr),
not an inference from a model name or a local env filename.

The public model catalog returned 31 endpoints but no retention-policy flags.
One synthetic restrictive-route probe returned HTTP 200, the expected V4.1
model, CoreWeave and `{ok:true}`, at USD 0.0000131. It proves gateway routing
availability only, not actual provider retention, account settings or deployed
privacy. Its complete priced receipt is
`work/conversation-eval/privacy-1791259909417.json`. Cumulative evaluation
allocation is now USD 1.6332342014 of USD 5; USD 3.3667657986 remains.

Verification: 918 API unit tests, API types, migration and diff checks pass.
Operator CLI tests use synthetic provider metadata and secret-bearing errors,
without network access. Wrong/unsafe origins and unapproved budget choices are
refused without sensitive output. No SQL/schema change, remote mutation, push
or deployment occurred. This prepares acceptance checks; it does not pass the
remaining monetary, proxy, privacy, deployment or human comprehension gates.

### Operator verification commands

After authorized deployment, export actual API/worker environment objects into
a protected local JSON file under `api` and `worker`. Run
`node scripts/verify-runtime-configuration.mjs --stage=development --config=PATH`
and retain only its sanitized result. Do not paste the exported environment
into a PR or log. A proxy count being present is not proof the caller cannot
reach the origin directly or spoof a forwarded address.

With the verified stage key supplied as `OPENROUTER_API_KEY`, run
`node scripts/verify-model-key-limit.mjs --limit-usd=APPROVED_AMOUNT --reset=APPROVED_PERIOD`.
The reset period must be daily, weekly or monthly. Replace the placeholders
only after the owner's choice. This makes no model request or budget change.
Check stage-key separation and Gemini controls separately. Exercise live alarms
and stage timings only under authorized delivery, retaining failure receipts.

### Milestone 4 bounded history checkpoint on 2026 10 05

Large-body measurement resolved the conditional paging decision. Maximum-size
Korean placeholders in a 200-message thread produce 2,221,883 bytes for the
full projected rows, before API envelope or transport compression. Initial
thirty-message API delivery is 334,997 bytes (repeated sources), or 334,432
bytes with varied sources. The final size receipt is
`work/performance/long-conversation-window-final-size-1791261615695.json`.
These are synthetic uncompressed bounds, not transfer-time or compression
guarantees; one intermediate run overlapped web tests and is not a timing gate.

Implemented explicit tail/expanded windows, preserving legacy full-thread
requests, total revision fences and every immutable message. The browser opens
the latest thirty and offers Load earlier messages, expanding by thirty
positions. Loaded spans are refreshed/revalidated, not cached as source proof.
Original-topic previews remain scoped to the full conversation. Write validation
still uses the complete thread; lost-response replay includes the actual
confirmation anchor. Invalid write windows roll back inside the transaction.
Uncertain-write reads do not assume a commit: they inspect the current tail and
expand only when its expected position is hidden. Scoped scroll metadata keeps
the loaded boundary through Back/reload; old scroll records request the full span.

Verification: 918 API unit tests, 793 web tests, 42 conversation SQL cases,
API/web/performance types, build, migration and diff checks pass. New checks
cover contiguous DTOs, foreign windows, malformed ranges, legacy access,
rollback, old replay confirmation, unchanged sidebar topic, draft/read failure,
scroll anchoring and reopening. SQL fixtures initially omitted client IDs and
were corrected; the replay test retained its GET-only/no-resend assertions.

Built browser evidence used an owned 80-message fixture with provider network
and autodrain disabled. It opened thirty messages, expanded to sixty and eighty,
preserved the old visible anchor and earlier-reading date labels, then reopened
the sixty-message span at exactly the same 8,332-pixel scroll position. Screenshots
are retained under `work/performance/beta-m4-window/`. No real account or paid
model was involved; this is not first-time comprehension or cloud verification.

Mixed-version clients fall back only when an old server explicitly rejects
the new query shape before its write route. Durable IDs/body are unchanged;
ambiguous failures and actual window errors do not replay. The full web gate
initially lost two writes because its text scan did not follow local helpers.
AST discovery now follows helper calls with a cycle guard, retains both verbs
and self-tests that delegated reads are not writes. No register entry was removed.
The owned browser schema was removed after normal shutdown and checked absent;
temporary tabs and viewport overrides were cleaned up, with screenshots retained.

The full goal remains open for monetary policy choices/actual enforcement,
alert destination and live delivery, authorized rollout, attested runtime and
provider settings, deployed stage/concurrency measurements and human UX evidence.

### First time user check

Use a fresh synthetic preview, not an existing user's account. Give participants
only the tasks below, without naming or pointing at the relevant buttons. Record
each participant's first action, completion, requests for help, and wrong turns.

1. Keep a new idea privately, and return to its unfinished draft after closing.
2. Find one saved idea to revisit and move on without removing it.
3. Find the guides WAKA has gathered for making choices.
4. Open a conversation about one of those guides.
5. Prepare an image of a guide to share, without changing the saved wording.

Do not count an expert/agent walkthrough as first-time comprehension. Use the
observed results to repair unclear paths before passing the human gate.
