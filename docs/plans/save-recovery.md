# Save recovery — design note

Follow-up to "Save recovery redesign" in `docs/known-issues.md`. Design first, then the minimum.

## What a person sees on dev

**The composer jams after an offline save** (usability audit item 1). Save is pressed, the journal
is written, the network drops. The bar says "Couldn't confirm the save" and Save stays disabled.
Reconnecting and reloading only READ `GET /inspirations/save-requests/:id`; it answers 404
`save_not_found`, the journal is kept, and nothing is ever re-sent. Only pressing Retry gets out.

## What this PR does (and only this)

Only **this tab's own saves** are ever re-sent: request ids created by `start()` are kept per tab in
`sessionStorage` (survives a reload of that tab, nothing else), snapshotted at first mount.

- **First page load** reads this tab's own journal from disk and re-POSTs it, same id and body.
  Effect re-runs (`enabled`/`prefix` changes) only read; one after a POST was issued never re-POSTs.
- **`online`** re-POSTs this tab's own pending journal under the same id.
- If the tab is hidden or a run is in flight, that resend is owed (in-memory flag), consumed only by
  this tab's own visible, idle scan of its own journal (focus/visibility, or the end of the run).
- Another tab's journal is only read, on every path (load, online, refresh, storage, focus).
- **Retry** is unchanged from dev (re-POSTs the in-memory intent, same id).
- Focus and storage events still only READ, exactly as on dev. Load/online sends are not presses
  (`initiated=false`); Save and Retry are.
- `busy` clears when a superseded run ends, not only when the current run ends.

## The rules this relies on

- The server is idempotent on (profile_id, request_id): a committed id replays, a concurrent same-id
  POST gets 409 `save_in_progress`. So re-POSTing the same id + immutable body can never make a
  second copy.
- A journal is removed only when its id lands (2xx), is refused by validation (400, words offered
  back by "Edit"), is removed (410), or the person discards it. Never on 404, 5xx or a timeout.
- No "did not land" inference, no tombstones, no cross-tab coordination, no persisted pressed flag.

## The cases from known-issues

| Case | Handled how |
| --- | --- |
| Gateway 5xx vs our 500 | Not distinguished: every 5xx keeps the journal; a later same-id re-POST commits or replays. |
| "Not found" is not "did not land" | 404 never releases a journal; on load/online it leads to a same-id re-POST. |
| Cross-tab journals | A tab re-sends only journals it created (per-tab `sessionStorage` ids); another tab only reads them, as on dev. Open: an orphaned journal (its tab closed) is never re-sent by another tab, only by Retry there; a duplicated browser tab copies `sessionStorage` and so shares ownership (server dedupes). |
| 409 `save_request_conflict` | Unchanged from dev: "uncertain", journal kept. It can mean the id already landed, so it must never release the journal or offer the words back as new. Open. |
| 409 `save_in_progress` for the pressing tab | Unchanged from dev: "Couldn't confirm", no acknowledgement. Open. |
| "Save as new" while pending | Not offered, as on dev. Open. |
| The why (photo reflections) | Unchanged from dev. Open. |
| Same words, current draft revision | Fixed in increment 1 (2026-10-28): text saves bind the pressed draft revision; settlement checks the revision after asynchronous cleanup, including the text-only fallback without IndexedDB. |
| Acknowledging a press | Load/online sends report no press; a press then answered by a later load/online resend is not acknowledged. Open. |
| 410 `saved_item_removed` | Increment 1: Home awaits `onRemoved` settlement and uses the same newer-draft protection as a successful save before releasing the journal. |
| Sign-out | Unchanged: `pendingSave:` is kept across sign-out by design. |

## Core-logic review, increment 1 (2026-10-28)

Scope: text-only save acceptance and recovery. Saving confirms persisted words;
it does not wait for or promise AI generation. Each pending save retains one
immutable body, request ID and profile owner. Newer drafts are identified by
draft ID and revision, not by whether their text differs from the saved words.

Defect-first Home tests reproduced lost newer drafts during initial storage
flushes, during successful-save cleanup, and in the text-only fallback without
IndexedDB. A separate removed-save check proved Home released the journal before
its asynchronous cleanup finished. The fix binds text to the pressed revision,
returns whether cleanup actually settled that current draft, and awaits cleanup
on both success and removal. The save deadline also bounds cleanup; callbacks
recheck the active attempt after storage waits, preventing a timed-out completion
from updating a newer draft after retry. No server schema, generation or retry
policy changes.

Verification covers rapid double submission, immutable retries, lost responses,
reload/online recovery, newer drafts, same-account agent switches and return,
removed saves, and blocked storage. API route tests use an explicitly named
disposable loopback database with real transactions; Home tests use browser API
fixtures. No model calls or shared data are required. These checks do not stand
in for physical iPhone/Android acceptance. Later increments remain separate.

Local gate result: web typecheck/build passed; 1,412 web tests across 179 suites
passed, including the new Home-level race regressions. All 38 targeted API tests
passed against the disposable local database. No duplicate save, lost newer
draft or wrong-profile resolution remained in the exercised cases. No migration
is required; this increment is verified locally, not deployed.

## Core-logic review, increment 2 (2026-10-28)

Scope: inspiration attachments and source material. This extends increment 1's
pressed-revision rule to the entire selected manifest. Upload receipts may
advance that revision only while no human edit has intervened. The manifest is
built from the submitted snapshot, not the live draft after an upload wait.

Defect-first tests reproduced newer identical words being cleared during an
upload, consumed file tickets remaining on newer drafts, and an unbounded
stalled upload. Successful cleanup now removes only that save's uploaded object
keys from the same newer draft, preserving its words, other files, links and
unchosen recording. Each file transfer (presign + PUT) is bounded at two minutes;
failure retains its bytes and previous successful receipts. Chat's separate
upload/finalize cancellation contract is unchanged.

Enrichment regressions reproduced link/image rereads on replay and a slower
failed read replacing already committed successful material. The worker reuses
ready link/image/audio text and checks again in the transaction before writing.
Source changes, parent deletion, transcript revision changes and lost worker
claims still refuse stale publication. Cached source material remains separate
from the author's text and its learning request commits transactionally.

Verification includes partial upload → reload → remaining upload → lost save
response → same-ID retry, plus removed originals, restoration, profile access,
transcript corrections, retry budgets and exact upload metadata verification.
Browser tests use owned IndexedDB and controlled API responses; SQL scenarios
use an explicitly verified disposable loopback database. No shared user data,
live provider/model requests or physical devices are involved. This verifies
recovery and persistence contracts, not live-provider extraction quality.

Existing capability boundary: document files are retained for opening, marked
analysis-unavailable, and are not automatically parsed into memory. Supported
machine material remains link page text, image descriptions and recordings.
Adding PDF/Office/text-file parsing is a separate feature decision. No schema
migration or deployment is part of this increment.

Local gate result: web/API typechecks and the web build passed. The web suite
passed 1,419 tests across 179 suites; API unit checks passed 1,002 tests (five
intentionally skipped). All 80 selected SQL checks across nine suites passed
against `waka_attachments_increment2_test_20261028` on verified `127.0.0.1`.
No wrong-profile access, partial committed attachment bundle, lost newer draft
or overwritten successful enrichment remained in the exercised cases. Verified
locally, not pushed or deployed; live-provider quality and physical-device
acceptance remain outside this gate.

## Core-logic review, increment 3 (2026-10-28)

Scope: signal discovery, matching and evidence integrity. Reviewed source
inputs and attribution, quote checks, source/statement fences, independent
support and confidence, profile isolation, owner locks, support withdrawal,
failure rollback and replay. No confidence weights or promotion thresholds
changed. The three-witness bar is promotion, not a requirement that an already
active signal must always retain three witnesses.

Defect-first tests reproduced high-cosine automatic attachment of distinct or
opposing claims, provider failures bypassed by that fast path, and loss of a
second meaning during within-reply cosine deduplication. Different wording now
gets a semantic judgment for the single nearest eligible target, even above
the old automatic attach bar. Identical wording retains its fast path; exact
duplicates are embedded once. This adds up to one match judgment per changed
candidate (at most three extraction candidates), before source locks or writes.
Failed judgments retry without adding evidence or inventing an independent
claim. Independent meanings mint separately; opposed meanings retain the
existing owner-arbitrated contradiction mechanism.

Additional regressions reproduced matching and suppression through vectors
whose input hash describes other wording. Both readers now ignore those stale
caches. The existing broad similarity-based dismissal rule is otherwise
unchanged; this review does not redefine what an owner dismissal means.
Human wording remains locked, support remains profile-owned, and repeat
processing does not manufacture witnesses or increase confidence.

Recording context was mislabeled as an image description in extraction. It is
now explicitly transcript material; saving a recording is not agreement with
its speaker. Source-language statements, source-language reasons and original
quotes remain distinct from the profile-language Top of Mind. Only verified
own-text/answer spans become new evidence quotes under the existing policy;
attachment context is still available to extraction without being presented as
the owner's authored words. A valid quote alone is not proof of semantic
entailment: model quality is a separate measured gate.

The initial eight-case live sample found a false opposition between a standing
preference and an undecided one-week trial. The judge prompt now explicitly
preserves certainty, temporal limits and past/current distinctions. Three such
cases were added to the reusable live judgment bench. The corrected sample
kept the trial independent, retained a genuine opposition, kept English/Korean
source language, produced no pattern for a dentist reminder, and did not adopt
a guest speaker's preference as the owner's. Near-verbatim signal wording is
allowed; the Top of Mind's synthesis rule is reviewed separately.

Local gate results: API typecheck and all 1,003 API unit checks passed (five
intentionally skipped). All 98 selected SQL cases across nine suites passed
against a disposable database on verified 127.0.0.1; the new matching suite
covers negation, temporary scope, failed judges, exact replay, stale caches,
sibling isolation, locks and multiple meanings in one extraction. No migration
is required. No shared user data was changed or historical signals regenerated.

Live checks used synthetic inputs and the configured
`deepseek/deepseek-v4.1-flash-1017` route. The 27-pair judgment bench passed its
80% accuracy floor and zero-invented-opposition gate; the 16-case extraction
bench passed its 80% floor and zero-meta-reference gate. These are threshold
passes, not claims that every case or every real archive is correct. The
extraction bench initially failed before dispatch because its input fixture
omitted `existingCategories`; that fixture is repaired. Two eight-call samples
plus the two live benches made 59 billed calls, totaling $0.006506244 in returned
provider usage. Reports/logs are in `/tmp/waka-increment3-*`; existing `work/`
artifacts were not overwritten.

This increment is local, not pushed or deployed. Physical devices, live-archive
calibration, historical repairs and changes to dismissal semantics remain
outside this gate. Next: Top of Mind — refresh triggers, selected language,
cross-inspiration synthesis, repetition and stale/removed-source behavior.

## Core-logic review, increment 4 (2026-10-28)

Scope: personal Top of Mind selection, synthesis, publication and refresh.
Reviewed automatic/manual cadence, selected language, distinct source origins,
copied wording, repetition, stale/deleted support, profile access, human choices,
publication failures and concurrent writers. The 24-hour automatic content-shift
floor remains; manual requests, including language changes, wake held work.
No selection weights, source thresholds, model routing or schema changed.

Defect-first regressions reproduced four gaps:

- An entry with an invented citation could publish after trimming that ID,
  even when two remaining citations were valid. Invalid references now reject
  that entire proposal entry; an existing valid reading survives failed output.
- Duplicate machine wording, including cosmetic case/spacing/final-punctuation
  variants, could publish twice and persist through `noChange`. Proposed and
  carried machine entries are deduplicated by visible wording. Exact human
  choices take precedence and deliberate duplicate human entries remain intact.
- A signal with many witnesses could consume all four review source slots
  before another cited signal contributed any context. The same bounded window
  now samples across cited signals first; repeated-source fingerprints still
  count once and excerpts remain capped at 1,600 characters per original.
- Diversity could compare current-hash vectors from different embedding models
  in one coordinate space, hide distinct signals and leave no reading to
  synthesize. It now uses only the current embedding model's valid caches.

Local checks: API typecheck and 1,004 unit tests passed (five intentionally
skipped). Fifty reading/refresh/wake SQL checks across six suites passed, plus
47 source-projection/generation/worker-fence checks across three suites. These
include wrong-language and copied output, two-source requirements, failed
reviews, older workers, profile boundaries, changed support, language races,
owner locks and manual wake-ups. Tests used an explicitly verified disposable
127.0.0.1 database; no shared user archive was changed.

Live validation used synthetic fixtures only. All 14 English/Korean publication
review cases passed, including wrong language in optional fields, invented
claims, decorative citations and falsely resolved tensions. Two additional live
SQL cases ran real synthesis → publication review → version persistence in
English and Korean from English originals. Both produced a non-copied reading
with citations covering both owned originals. These opt-in cases live in
`packages/api/src/lib/top-of-mind-live.db.test.ts`; they skip during ordinary
hermetic test runs. This is a bounded synthetic check, not calibration over
real user archives or a guarantee of model correctness.
The six live calls reported $0.001693097 in provider usage, with no unpriced
requests. The final typecheck and generation-documentation gate also passed.

This increment is local, not pushed or deployed. No migration or physical-device
test is needed for these backend changes. Historical versions were not rewritten;
duplicate cleanup applies when a profile next refreshes. Logs and live usage
measurements are in `/tmp/waka-increment4-*`; existing `work/` artifacts remain
untouched. Next: Principles — eligibility and generation triggers, evidence
requirements, merging/conflicts, owner declarations and edits, and recovery
when supporting material changes.

## Core-logic review, increment 5 (2026-10-28)

Scope: Principle eligibility, triggers, proposal grounding, matching/conflicts,
declarations, owner edits, rank and support-loss recovery. Initial eligibility
remains three active, evidenced signals with distinct statements and at least
one citing reading version; no calendar wait or daily generation promise was
added. Changed material requests deduplicated background work; completed work
is not repurchased by a GET. Nightly/local recovery and explicit retries remain.

Fixed three integrity gaps:

- A proposal could survive after an unoffered reference was trimmed away.
  Foreign/retired references now reject its whole candidate. The shared parser
  also rejects candidates with non-string or blank citation values instead of
  silently repairing their source list.
- Promotion could claim an edited instruction was demonstrated using links
  attached to its previous wording. Support-loss maintenance likewise missed
  obsolete signal/Principle revisions or could salvage three links after a
  fourth was withdrawn. Both now use the complete current-citation predicate
  used on reads. Owner words survive; fresh grounded matches can restore
  support while preserving rank and an open dispute.
- Duplicate wording counted once during candidate validation but could count
  several times during eligibility, reads, promotion and maintenance. Those
  paths now count distinct normalized statements consistently. Case, spacing
  and Unicode compatibility variants do not buy model calls or demonstrated
  standing. Different paraphrases still need the semantic model's judgment;
  normalization is not a proof of independent meaning.

Validation: API typecheck, all 1,008 API unit checks (seven explicit live-eval
skips), and 92 selected SQL checks across eight suites passed. Nine new SQL
cases cover complete citation rejection, stale wording, preservation and
recovery of human choices, duplicate wording and profile-scoped promotion.
Existing checks cover declarations/routing, resumable paid steps, failures,
retries, unchanged readings, owner conflicts and concurrent publication.
The final targeted unit/documentation gate also passed. Tests used a disposable
database on explicitly verified 127.0.0.1, never the shared archive.

Live synthetic validation persisted a grounded generated Principle in English
and Korean from English source statements. A separate batch passed three
grounding verdicts (supported, invented costs, unendorsed reference) and 14
English/Korean relation verdicts, including real conflicts, unrelated guides,
different time scopes and an instruction-in-data control. Seven configured
`deepseek/deepseek-v4.1-flash-1017` calls reported $0.000972925, with zero
unpriced requests. These are bounded controls, not real-archive calibration or
a guarantee of model correctness. Logs are in `/tmp/waka-increment5-*`.

This increment is local, not pushed or deployed; no migration is needed.
No historical wording or shared data was rewritten, and existing `work/`
artifacts were untouched. Next: review prompts and answers — how inspirations
are selected, timing and repetition, deleted/changed-source handling, answer
recovery, and how validated answers contribute evidence without inflating it.

## Core-logic review, increment 6 (2026-10-28)

Scope: what the current avatar asks the human to review, selection order and
repeat intervals, failed/stale answer recovery, and retained inspiration-review
APIs and evidence. The old inspiration-review panel and routes were removed
from the web UI; their server storage is still used for existing human answers.
The active and retained contracts are now distinguished in the data model and
the new **Review: what WAKA asks, and when** section in `docs/generation.md`.

The active rules are explicit: Top of Mind first; review opens by choice;
three cards total per sitting; oldest pending collector picks first because
they expire after seven days; unanswered active/emerging readings next, newest
evidence first; and aged `true`/`partly` answers last, oldest answer first after
90 days. Confidence does not rank unanswered readings. A new wording needs a
new verdict after its evidence is revalidated. The same rejected wording does
not return. Agent profiles do not ask the human to validate agent memory.
The cap describes a sitting, not a daily generation promise. A short explanation
is included in How WAKA works in English and Korean; the 90-day value is pinned
to the backend constant by the documentation gate. First-time cards explain
that this wording has not been reviewed.

Defect-first regressions reproduced and fixed:

- Both signal queues admitted stale support; unsupported and source-less rows
  could also appear in the unanswered queue. The complete owned-support check
  now runs before pagination, so invalid rows cannot crowd out valid ones.
- The yielded side of a settled contradiction could still be asked as an
  unanswered reading. It now follows the existing exclusion for aged re-asks.
- A failed verdict animated away and silently ended the review; a slow save
  allowed the interface to advance before its answer was confirmed. The write
  and animation still start at the press, but departure requires confirmation.
  Failure returns the same card with retry wording, slow saves expose progress,
  and a repeat press cannot dispatch a second verdict. Lifecycle checks prevent
  an old card callback from removing another card. A stale-wording rejection
  rechecks existing sitting IDs without refilling the three slots or applying
  the rejected answer to revised words; the person chooses again.
- Separate three-pick and three-reading limits produced six cards. One shared
  three-slot selection now preserves pick priority and rejects stale queue-load
  replies after a profile change, reconnect or unmount.
- The retained inspiration-review API's cooldown ignored a just-written
  reflection. Authored nonblank, unskipped reflections now join review choices
  in the 24-hour engagement clock. Its projected reviewed flag also lost SQL
  column qualifiers inside Drizzle's single-table projection and mislabeled
  reflected sources as unreviewed; explicit correlation fixes that. Explicit
  source selection still bypasses the cooldown. No old web flow was restored.

Verification: API/web typechecks, 1,009 API unit checks (seven explicit live-eval
skips), all 1,423 web tests and the web build passed. All 166 selected SQL checks
across eleven suites passed on a disposable database at verified 127.0.0.1.
They include answer replay/edit/deletion, stale AI premises, source deletion,
profile ownership, bounded retries, queue recovery and independent-origin
accounting. One retained Principle-result fixture was corrected to supply
active, independently supported signals under increment 5's demonstrated-support
contract. No model prompt, numerical generation threshold or schema changed;
no live provider call, real user archive mutation or phone check was performed.

This increment is local, not pushed or deployed; no migration is required.
Existing `work/` artifacts remain untouched. Logs are in
`/tmp/waka-increment6-*`. Next: chat and retrieval — profile and conversation
context selection, source citations, stale/deleted material, human wording,
and duplicate-send/retry/cancellation behavior.

## Core-logic review, increment 7 (2026-10-28)

Scope: profile-scoped chat history and memory, lexical/semantic retrieval,
current and historical citations, corrections, draft/Send recovery, reply
retry/Stop/deletion, dispatch accounting and final publication. The rules and
limits are recorded in **Chat and retrieval: which memory a reply uses** in
`docs/generation.md`; the data model also distinguishes the current profile
UI from retained legacy perspective/citation APIs. No new UI was introduced.

Two gaps were reproduced and fixed:

- Final publication locked only the owning profile's generation revision.
  Raw inspiration edits need not advance that revision before a signal cites
  them, and legacy Both/agent-memory reads also span another profile. Real SQL
  pauses placed after the final source read showed selected agent edits could
  commit before the reply insert. Publication now additionally locks selected
  raw material revisions and the selected agent's generation revision until
  the reply commits. Nonwaiting source locks yield to an active editor rather
  than deadlocking it or repurchasing the model call. Unrelated agent writes
  remain independent. No lock spans network work. Five publication cases cover
  raw personal/agent/Both context and agent/Both Principle context, with another
  case proving an active raw-source editor completes and the user message stays.
- A new chat directly owned by an agent profile used the right source rows but
  did not tell the model those rows belonged to an agent. A route/worker test
  reproduced the missing ownership label. The owning profile's type now adds
  agent attribution to the existing prompt input without changing its stored
  `mine` perspective or borrowing human saves. A live legacy agent-only sample
  also said "my working history", claiming WAKA had done another agent's work.
  The agent prompt now describes "your agent"/"this agent" rather than speaking
  as that separate agent.

The preserved rules include atomic message/reply intent, stable IDs for uncertain
Send recovery, one pending/running reply, explicit paid retry after ambiguous
dispatch, source/citation revision checks, removal of stale assistant turns from
future model history, and corrections that do not silently edit saved memory.
Retrieval and excerpts remain bounded. Chat-attached photos/files are stored
but their contents are not read by the reply model; ready inspiration enrichment
is a separate path. The legacy unavailable-agent fallback remains the human
owner's memory; current profile-owned chats do not opt into that legacy scope.
No retrieval threshold, model route, numerical budget or schema changed.

Validation: all 1,009 API unit checks passed (seven explicit live-eval skips),
123 SQL checks across nine suites passed, and 108 focused web checks across six
suites passed. API typecheck passed. The SQL run used a disposable database on
explicitly verified 127.0.0.1; no shared archive or historical row was repaired.
SQL model outputs are scripted; paid quality checks were separate.

Two six-call synthetic live samples used the configured
`deepseek/deepseek-v4.1-flash-1017` route. Manual inspection of the corrected
sample confirmed the targeted English/Korean temporary-wording, old-record-date,
injection and owner-attribution controls; the agent no longer claimed the work
as WAKA's own, and Both kept the two owners distinct. This small sample is not
real-archive calibration or proof of semantic correctness. Twelve calls reported
$0.0017514576 in total, with zero unpriced requests. Original before/after
responses and logs remain in `/tmp/waka-increment7-*`; existing `work/`
artifacts were untouched. No physical-device check was performed.

This increment is local, not pushed or deployed; no migration is required.
Next: deletion, restoration and erasure — source cascades, human-kept wording,
recovery without duplicates, attachment retention, and cancellation/revocation
of queued work and credentials when a profile or account is removed.

## Core-logic review, increment 8 (2026-10-28)

Scope: inspiration deletion/restore, source cascades and locked words, attachment
retention, queued work, agent deletion and complete account erasure. The rules
now live in the deletion section of `docs/generation.md`; the data model records
the new restore fence. Existing `work/` artifacts were untouched.

Reproduced and fixed:

- A second restore in the same millisecond could reuse the first restored
  material revision, admitting stale work or an old confirmed delete. Migration
  0081 retains both bigint revision floors in the deleted copy. Restore advances
  beyond each floor, with precision-preserving decimal strings in exports.
  Repeated/backwards clocks, values above JavaScript's safe integer range and
  stale confirmed removals are covered. The source revision is checked under
  its final write lock. Legacy copies lack their original floors and keep the
  clock fallback; this review cannot reconstruct that missing history.
- Account erasure inventoried profiles/files only before the network request.
  A new agent and its live/deleted attachments could arrive during that request
  and be cascaded away without an external deletion. The final transaction now
  locks the account and current profiles, rechecks their inventory and returns
  additional keys for deletion outside SQL locks. External passes are capped
  at three; failure or continuing churn leaves inventory available for retry.
  Deadlock retries preserve the existing separate three-attempt bound. External
  erasure requests now have an eight-second batch timeout and release clients.
- Account erasure could sweep a legacy object referenced by another account,
  despite other delete paths preserving such references. The common key lookup
  can now exclude the profiles being erased while protecting remaining live
  and deleted references.
- Best-effort sweeps ignored S3 per-object errors in successful HTTP responses.
  They now log a count without exposing keys or provider messages and continue
  remaining batches. Transport failure still cannot undo a committed SQL delete.

Verification: 1,011 API unit tests passed, with seven opt-in live skips; 149 real
SQL cases passed across sixteen suites; 43 web recovery/delete/restore cases
passed. API typecheck and migration checks passed. SQL coverage includes a
paused final account cascade: new agent/attachment inserts are blocked while
another account remains writable. The real profile-delete route and auth prove
that both a removed agent's API key and its session stop resolving, queued work
is removed, the human session remains valid and sibling memory survives.
Source-processing, in-flight audio, human-word locks, Principles reconciliation,
exports, save tombstones and chat-attachment cleanup were included. Focused
post-review checks reran the affected restore and confirmed-delete cases.

All SQL mutations used `waka_erasure_increment8_test_20261028` on explicitly
verified 127.0.0.1. External bytes/model calls were scripted; no paid generation,
real S3 deletion, browser walkthrough or physical-device test was performed.
Logs are in `/tmp/waka-increment8-*`. The disposable database was removed after
verification. This increment is local, not pushed or deployed. Migration 0081
is required before the new code is deployed; no shared database was migrated.

Production gates remain open in `docs/goals/beta-readiness.md`: durable retries
for post-commit cleanup, inventory/cleanup of outstanding or unfinalized
presigned uploads, and verified owner alert delivery. Logs alone do not establish
complete external erasure. No cloud cleanup/notification configuration changed.

Next: MCP connections and API keys — review which profile a connection binds
to, consent and permissions, expiry/revocation, keeper versus agent credentials,
foreign/sibling read and write refusal, and whether setup instructions accurately
state what each connection can do. No new connections will be installed by
that review without an explicit request.

## Core-logic review, increment 9 (2026-10-28)

Scope: MCP profile binding, consent, API-key issuance, expiration/revocation,
keeper versus agent permissions, the public package and setup instructions.
`docs/mcp-distribution.md` now records the actual connection/scope rules;
`docs/data-model.md` records the narrow self-identity allowance and key cap.

Reproduced and fixed:

- Concurrent key creation could exceed the five-live-key limit for both agent
  and personal keeper keys. Issuance now locks the target profile and performs
  the count/insert in one transaction. Real SQL races starting at four keys
  admit one request and refuse the other, leaving five active credentials.
- The published MCP client verifies its bound identity before accessing memory,
  but keeper keys were denied the identity endpoints and verification POST.
  Their positive allowlist now admits exactly self identity, self-only profile
  discovery and matching-profile verification. Verification updates keeper-key
  activity rather than looking for a session row. No curation, sibling/foreign
  memory, account administration or login approval is granted. Existing profile
  filtering already returned only the keeper's own profile.
- The verification endpoint rejected a valid lowercase bearer scheme even
  though authentication accepts it. It now handles the scheme consistently.
  Cookie-only requests, including misleading blank/other authorization headers,
  still do not count as MCP verification.
- The public client rejected an entire inspiration list containing `audio` or
  `decision`. Its response schema and type now recognize both persisted kinds.
  Reading these records does not add audio uploads to the text capture tool.

The narrow client fix was committed locally in `waka-mcp` as `d4c75e4` because
release packaging requires a clean committed source. The release audit then
reported `qs` and `@hono/node-server` advisories; patch overrides 6.16.1 and
2.1.3 were applied, tested and committed locally as `6357c16`. The production
client dependency audit is clean. The new immutable archive and manifest were
built from that commit; the old archive is retained. No MCP configuration or
existing credentials were installed, read or changed. Nothing was pushed.

Verified rules: browser-approved sessions last thirty days and have their own
revocation rows; approval codes last two minutes and are consumed on exchange.
Explicit requested profiles cannot be swapped during consent. Agent sessions
and keys cannot approve their successors or administer the account. Standing
keys have no clock expiry and remain active until revoked. A legacy personal
CLI session retains the full account permissions disclosed by consent; it is
broader than a keeper key. Configuration scope controls where a client enables
MCP, not what memory its credential can access.

Verification: 1,011 API unit cases passed (seven opt-in live skips), 46 real SQL
cases across nine suites, 22 web settings/setup cases, 50 client tests and four
public installation smoke checks. API/web/client typechecks and the web build
passed. The actual published archive ran over stdio against real HTTP routes
and Postgres for Noah, Anotherone and the personal keeper: verify, own-profile
discovery, save, read audio/decision captures, read the other layers, reject
cross-profile requests and stop after revocation. Server-level negative checks
bypass the client's guard and still refuse access/escalation. The remaining SQL
suites cover consent binding, historical grants, expiry and profile deletion.

All SQL mutations used `waka_connections_increment9_test_20261028` on explicitly
verified 127.0.0.1; the disposable database was removed after verification.
Logs remain in `/tmp/waka-increment9-*`. No real memories, model calls, shared
DB migration, deployment, physical-device test or personal MCP installation
were involved. Existing `work/` artifacts were untouched. This increment adds
no migration; the previous local migration 0081 is still required on delivery.
Existing installations retain their immutable package URL and must rerun setup
with the new URL after deployment to receive the parser fix.

Next: queued work and failure recovery — job coalescing/idempotency, stale leases,
attempt limits, edits/deletions superseding old jobs, model-spend reservation,
profile/language fences and operator visibility. Distinguish legitimate cadence
or budget waits from failures; keep technical progress out of the user journey.
Owner notification delivery remains the separately deferred production gate.

## Core-logic review, increment 10 (2026-10-28)

Scope: queue admission, coalescing, attempts, holds, retry wakes, stale leases,
publication fences and model-budget history. The owner's explicit constraint is
no recurring database pings: preserve serverless idle suspension. No persistent
worker, watcher, recovery heartbeat or cloud configuration was started/changed.

Reproduced and fixed:

- `dev:drain` polled every three seconds and `dev:local` launched hourly nightly
  recovery, despite the launcher's comment promising a once-per-boot pass.
  Both maintenance commands are now one-shot and reject `--watch` before
  loading the database. Boot runs one maintenance pass; build/file watching
  continues independently of database work. A process inspection found no old
  local drain/nightly polling process running.
- The local next-deadline query considered every pending row. A job from a newer
  API, unsupported by this worker, could generate an immediate timer loop with
  no eligible work. The scheduler now uses the worker's eligibility predicate
  with an unbounded deadline, so supported future work still gets one wake.
  Pending jobs at their attempt ceiling are now ineligible too. Real SQL proves
  that unsupported/exhausted rows do not arm a timer, while a known future job
  gets a single deadline even across repeated scheduling requests. Fake timers
  prove an empty queue stays idle after an hour of simulated time.
- A reusable job row's `started_at` overwrote previous starts, so repeated
  completed-key work undercounted hourly usage. A later hold could also erase
  the cost of earlier failed attempts. Migration 0082 adds `background_job_runs`,
  written atomically on ordinary queue claims. It retains account-level usage
  across job reuse and source/profile deletion, refunds only the exact held
  claim, and cascades on account erasure. Review and chat dispatch meters remain
  separate. Legacy snapshots are counted only if that start has no run record;
  previously overwritten history cannot be recovered. Two-day retention uses
  the existing daily maintenance event, not a new timer or recurring query.

Verified retained rules: keyed pending work coalesces, newer requests arriving
mid-run request a trailing pass, failed output has bounded per-request malformed
retries, ordinary attempts use bounded backoff, and stale workers cannot publish
against a replaced claim. Cadence/support holds return their attempt rather than
fail. Budget holds move due account backlog without claiming it. Known transient
failures can request Lambda's bounded native redelivery; longer waits, missed
wakes and stale leases retain existing activity/one-time/daily recovery paths.
The account throttle is not a hard dollar ceiling: admission and claim remain
separate under concurrency, stale-lease reclaim is grandfathered, and one job
can buy several calls. These limits are stated in `docs/generation.md`.

Verification: 1,016 API unit tests passed (seven opt-in live skips); 127 real SQL
cases across eleven suites passed. A focused six-suite pass covered 62 unit
cases, including command subprocesses refusing watch mode before DB access.
API typecheck, migration checks, launcher shell syntax and the explicit dry run
passed. Coverage includes claim fairness, retry idempotency, exact wake hints,
lease/write fencing, source cancellation, chat dispatch guards and account
removal. Existing daily infrastructure schedules are pinned by a regression;
no frequent recovery clock or idle polling can be added without failing it.

All SQL mutations used `waka_queue_increment10_test_20261028` on explicitly
verified 127.0.0.1; the disposable database was removed after verification.
No shared DB migration, paid model calls, real AWS schedules, deployment, app
server or personal connection was started. Existing `work/` artifacts were
untouched. Logs remain in `/tmp/waka-increment10-*`. Migration 0082 is prepared
locally and required with this code; earlier local migration 0081 remains part
of delivery. The existing daily Principle and maintenance schedules remain;
cloud state has not been audited or changed by this increment.

Next: targeted one-time recovery for budget deferrals and expired leases —
review due-time delivery, cancellation, duplicate events, request/profile
binding and failure visibility, without an idle database poll. Existing daily
safety recovery remains the fallback. Owner notification delivery remains the
separately deferred production gate.

## Core-logic review, increment 11 (2026-10-28)

Scope: one-time recovery for deferred work and expired leases, with no regular
DB pings. No recurring schedule, persistent worker or recovery heartbeat was
added. The existing daily Principle refresh and daily safety sweep are unchanged.

Implemented in `packages/api/src/lib/background-job-wake.ts`:

- Supported pending jobs share a self-deleting `at(...)` schedule by exact
  profile/deadline, covering budget, debounce, support and retry deferrals.
  A fresh token identifies each generation; later arrivals can replace the
  group, cancel its old timer and keep one current generation. A delivered
  group is retired before unfinished members receive a new timer. Concurrent
  replacement/deletion cannot cancel an armed newer generation.
- Every cloud claim arms its 15-minute lease watchdog before provider work.
  A scheduling failure becomes a support hold, returning that unspent attempt
  and only its own admission record. If deletion wins acknowledgement, no
  provider work starts. Settlement cancels the watchdog; a lease that remains
  running after missed settlement keeps its recovery wake.
- Deliveries revalidate identifiers, profile, exact deadline or lock/attempt,
  request version and current state. Normal claims retain fairness, budgets
  and publication fences. An exhausted final lease becomes failed without
  buying another attempt; a flagged newer request retains its own budget.
  The existing daily 24-hour abandoned-lease fallback remains in place.
- Source deletion and profile/account erasure collect timer references while
  holding their existing transaction locks, then cancel after commit. Shared
  pending timers stay while members of that same generation remain. Failed
  cancellation logs a safe error code/name; any late delivery still validates
  current queue state. No source text or credentials enter schedule payloads.
- Recovery arms at most 50 pending groups and 50 leases per batch. It creates
  one further metadata-only `at(...)` wake only after proving unarmed work
  remains. Empty recovery schedules nothing. A stale valid delivery can repair
  missing timers only in its own profile and does not run models. Configured
  precise timers replace the old deliberate native-retry signal; unexpected
  Lambda failures retain their existing bounded async retry policy.

Infrastructure retains the existing schedule group and invocation role resource
identities. The worker can create/delete only `waka-job-*` schedules in that
group and pass only its own invocation role. The API receives cancellation
permission only. There is no new migration for this increment; the earlier
prepared migrations 0081/0082 remain delivery prerequisites.

Verification: the full API unit suite passed 1,031 cases with seven opt-in live
skips. A subsequent six-suite focused pass passed 95 cases, including the added
stale-delivery profile-scope regression and the no-idle-clock checks. Thirteen
real SQL suites passed 152 cases, covering exact deadlines, duplicate delivery,
concurrent group creation/replacement, source/profile/account removal, lease
expiry, attempt ceilings, budget holds and worker publication fencing. API
typecheck, migration checks and diff whitespace checks passed. Logs remain in
`/tmp/waka-increment11-*`.

All SQL mutations used the explicitly verified loopback database
`waka_wakes_increment11_test_20261028`, which was removed after testing. Scheduler
transport was mocked: no real AWS schedules, shared DB changes, paid model calls,
deployment or app/worker process was started. Existing `work/` artifacts were
untouched. This is locally verified code, not a deployed recovery exercise.

Delivery review: verify actual due-time delivery, cancellation, IAM permissions,
bounded transport failures and idle database suspension after deployment. Use
Scheduler/Lambda logs and provider metrics, without introducing a monitoring
query. Owner notification delivery remains the separately deferred production
gate; this increment does not configure an alert destination.

## Core-logic review, increment 12 (2026-10-29)

Scope: make signal dismissal mean refusal of the same pattern, rather than
automatic refusal of every nearby vector. This is the first of the next logic
improvements; Top of Mind novelty, Principle source diversity, review selection
and chat continuity/attachments remain separate work.

Seven new SQL assertions failed before the change: high-similarity opposite,
temporary and changed-context observations were discarded without a semantic
decision; an unavailable judge was never reached; and a restoration during
judgment could not be exercised because no judgment happened. The fix plans
suppression before ordinary matching, with source/anchor revalidation before
any write. Identical trimmed wording has priority within the current bounded
anchor scan and needs no model call. Otherwise the nearest eligible dismissed
statement gets one meaning check; only `same` refuses the candidate. Other
verdicts continue ordinary matching without reviving the dismissed row or
creating a contradiction with it. Locked words and existing evidence stay exact.

This adds at most one suppression call per candidate (three per extraction
pass), using the existing judge, similarity threshold, 500-row scan, profile
scope and input policy. Other nearby anchors are not exhaustively judged.
All checks run as part of actual derivation; no polling or recurring DB ping
was introduced. Restoring an anchor ends future refusals; existing refusal
records remain historical and are not automatically replayed.

The shared relation parser also silently converted malformed responses into
`independent`, and both provider adapters did the same for a model decline.
Those cases now fail through bounded queue retries, without inventing a semantic
decision that could bypass dismissal. Explicit `independent` remains the
conservative answer to genuine uncertainty. This parser correction also applies
to ordinary matching. Extraction's no-candidates decline policy is unchanged.
The English/Korean dismissal receipt and canonical docs now describe refusal
of rewordings, rather than vector proximity.

Verification: 1,037 API unit cases passed (seven opt-in live skips), along with
47 real SQL cases across five suites, seven web receipt/localization checks,
API typecheck and diff whitespace checks. Coverage includes opposite meanings,
temporary trials, changed circumstances, same wording and confirmed rephrasing,
restoration, concurrent restore during judgment, sibling-agent isolation,
unchanged human locks, exact-wording priority and continued normal matching.
Both model adapters reject malformed and declined judgments without treating
them as independent meanings.

The fixed English/Korean live judge bench now additionally requires zero false
`same` verdicts. Flash 1017 passed 25/27 (93%), with zero false sameness and zero
invented opposition. Two expected rephrasings returned `independent`: small
tools versus returning to simple tools, and trusting plain text versus important
material ending up in plain text. These known misses remain in the bench;
semantic recall is not perfect. All 27 synthetic calls were priced, totaling
USD 0.0016717194. No user memories were used. This measures the existing judge's
semantic decisions separately from the SQL application of those decisions.

All SQL writes used explicitly verified 127.0.0.1 in
`waka_dismissal_increment12_test_20261029`; the disposable database was removed
and its absence confirmed. No new migration, deployment, shared-data repair,
app server or persistent worker was started. Earlier migration prerequisites
are unaffected. Existing `work/` artifacts were untouched. Logs remain in
`/tmp/waka-increment12-*`. Changes are local and unpushed.

Next review: Top of Mind novelty — distinguish a useful new connection or
changed focus from cosmetic rewording, preserve human-kept wording and the
24-hour automatic cadence, and measure false novelty/no-change decisions.

## Core-logic review, increment 13 (2026-10-29)

Status: **halted at the live novelty gate**. Only the deterministic publication
fixes below are enabled. The semantic comparison is an evaluation-only
prototype; no route, worker or environment setting activates it. Do not call
this increment a shipped semantic repetition detector.

The initial SQL cases reproduced four gaps: a cosmetic proposal could replace
current wording; a genuine proposal could be suppressed by synthesis's
`noChange` hint; missing comparison data was accepted; and cosmetic change
could restart the automatic content-shift floor. Scripted model fixtures prove
the application of comparison decisions, not the quality of those decisions.

Enabled fixes:

- Remove proposals repeating dismissed words or retyping human-kept words
  before publication review, matching assembly's actual behavior. If every
  machine proposal is refused, retain the valid previous reading and retry;
  do not silently clear it because assembly discarded the only proposed text.
- A valid machine entry may fill a truly empty reading despite an incorrect
  `noChange` hint. Human-only readings still carry meaning: their hint remains
  respected, and their words, locks and pins remain exact.
- Ask for exactly one quality verdict per supplied index, including duplicate
  wording at different indices. Keep display types out of the source-quality
  request. Publication diagnostics record an optional meaningful-change
  decision without source or generated text.

The prototype compares proposed/current machine entries after source checks.
It supports many-to-many meaning matches, exact-wording matches in code,
rejected-entry exclusion, optional fields, added/removed meanings and leading
focus. Missing or invalid matches fail closed. Scripted cases cover language
repair, human choices, unsupported fallbacks, empty readings, worker/revision
fences and preserving the 24-hour floor on semantic no-change. Ordinary
refreshes explicitly test that the prototype is not requested.

The predeclared live gate was at least 85% accuracy on 13 English/Korean
novelty cases, zero cosmetic false positives, and unchanged quality decisions.
A merged-repetition case was added as a separate required assertion; the
original 13-case accuracy gate was not relaxed. A whole-reading boolean,
entry alignment within the quality call, low-effort reasoning on Flash 1017,
and a separate meaning-only call were evaluated. The combined decisions were
inconsistent. The last separated run scored 11/13 on the original novelty
cases, missed changed time scope and a changed question, and incorrectly called
merged repetition new. It also failed a Korean quality expectation.

Reviewing that Korean fixture found that its supposed paraphrase strengthened
"may help" into necessity. The fixture now preserves possibility. The quoted
measurements predate that correction; no passing result is claimed for the
corrected corpus. The English question/time-scope and merged-repetition failures
independently keep the gate closed. Before another live run, review whether
bidirectional semantic coverage, rather than pairwise equivalence, represents
split/merged readings correctly. Do not retry unchanged prompts until one run
happens to pass, or lower the gate to declare success.

The retained prototype uses a separate comparison capped at 1,200 output tokens
on the configured judge, receiving only derived entries, not original sources.
Its telemetry has a controlled operation name. The experimental reasoning
override was removed. Normal refreshes still use their existing single quality
call; semantic comparisons would add one call only if explicitly enabled after
the gate. There are no new DB reads, queues, schedules or polling loops.

Verification: 1,052 API unit cases passed (eight opt-in live skips), 77 real SQL
cases across five suites passed, and API typecheck plus diff whitespace checks
passed. One existing worker-fencing fixture used three identical statements,
so the Principle diversity gate prevented it from reaching the model. Its
statements are now distinct, and a call-count assertion proves that reclaim
actually occurs during generation. No Principle production rule changed.
The live novelty benchmark remains failing and is deliberately not enabled in
normal tests or application refreshes. All 128 synthetic provider calls were
priced, totaling USD 0.03690889662; no real memories were used.

SQL writes used an explicit 127.0.0.1 URL for disposable database
`waka_novelty_increment13_test_20261029`, removed after verification. No
migration, shared-data repair, deployment, app server or persistent worker was
started. No recurring database ping was introduced. Existing `work/` artifacts
were untouched. Logs are in `/tmp/waka-increment13-*`; changes remain local and
unpushed.

Next review: validate the novelty rubric and corpus, then assess a focused
comparison representation/model on changed questions, time scope, split/merged
ideas, leading focus, false suppression and cost/latency before enabling it.
Principle source diversity, review selection and chat continuity/attachments
remain later increments.

## Core-logic review, increment 14 (2026-10-29)

Status: rubric/corpus review complete; semantic comparison still **halted at the
live gate**. Ordinary refreshes remain unchanged and the prototype is disabled.

The reviewed rubric is now explicit in
[`top-of-mind-novelty.md`](top-of-mind-novelty.md). Original labels and thresholds
remain fixed. The corrected Korean possibility fixture is included. A frozen
helper owns the 14 synthetic cases, independently measuring semantic comparison
with scripted quality decisions. Separate source-quality suites and three real
quality/comparison cases measure integration. Protocol failures are recorded
rather than stopping at the first bad example or counting a quality rejection
as successful no-change detection.

The prototype now requests directional coverage of **both** readings rather
than pairwise equivalence. A covering set must retain every claim and question,
including certainty and time scope. Repeated shorter/full statements need not
be equivalent to cover the same whole reading. The first measured version
still falsely treated redundant multi-row proofs as changed focus. A separate
leading-entry proof addresses that representation error. The actual compared
index is attached by the adapter, so source rejection cannot silently attribute
a leading proof to a different surviving row. A proof using any rejected row
fails closed; it is never trimmed into a supposedly sufficient subset.

Gate: at least 85% of the original 13 correct, no cosmetic false positives,
correct merged repetition and changed-question/time-scope decisions, with the
source-quality suites passing. One live pass per implementation was measured;
there was no unchanged-prompt retry to seek a green run. Directional coverage
scored 12/13 but falsely labeled split and merged repetition new. Adding the
leading proof scored 11/13: merged repetition and all three integration cases
passed, while split repetition and time scope failed. One unchanged quality
suite also rejected a supported navigation connection on the second run.
The feature therefore stays disabled; these figures do not establish reliable
semantic novelty detection. The rubric retains both failed runs.

Final verification: 1,056 API unit cases passed, with nine opt-in live skips;
77 real SQL cases across five suites passed, and API typecheck and whitespace
checks passed. Coverage includes complete bidirectional proofs, one-way new
detail, rejected covering rows, missing/foreign/duplicate/same-side targets,
leading-target binding, human choices, generation/worker fences and the 24-hour
floor. No production caller enables the comparison dependency.

All 44 synthetic model requests were priced, costing USD 0.0030598072 total.
There were 17 comparison calls per run. Comparison latency was median 598 ms,
maximum 3,871 ms in the first run, and median 798 ms, maximum 2,632 ms in the
second. These are bounded synthetic observations, not deployed timings.
The prototype comparison output cap is 1,800 tokens; it sends derived entries
only, with no raw inspirations or source IDs. No generation model setting was
changed. No real memory was sent to the evaluator.

SQL used explicitly verified 127.0.0.1 and disposable database
`waka_novelty_increment14_test_20261029`, removed after verification. No migration,
shared-data mutation, app server, persistent worker, deployment or push occurred.
There are no new recurring database checks, jobs or timers. Existing `work/`
artifacts were untouched; logs are in `/tmp/waka-increment14-*`.

Next gate: evaluate a different comparison judge or representation against the
unchanged corpus, including false novelty/suppression, changed questions,
time scope, merged/split ideas, source-quality interactions and measured
cost/latency. Keep the generation model and DB scheduling independent of that
evaluation.

## Core-logic review, increment 15 (2026-10-29)

Status: comparison-judge evaluation complete; semantic novelty remains disabled
because no candidate passed the unchanged gate.

Evaluated GPT-4.1 mini, Gemini 2.5 Flash and GPT-4.1 once each on the fixed
corpus and prompt. A new **test-only** `WAKA_NOVELTY_EVAL_MODEL` selects the
comparison candidate while preserving Flash 1017 for source quality and every
application generation setting. Integration collects all three results before
asserting, so one early failure cannot hide later measurements. No production
file, prompt, expected label, threshold or token budget changed this increment.

Original-case scores were 11/13, 13/13 and 10/13 respectively; all three
failed merged repetition. Gemini was best in this sample, with 13/14 overall,
2/3 integration cases, median comparison latency 776 ms and mean comparison
cost $0.000245. Mini and full GPT-4.1 achieved 11/14 and 10/14 overall, with
1/3 integration cases each. Their mean comparison costs were $0.000278 and
$0.001418, with medians 1,167 ms and 890 ms. No structural/protocol failures
occurred. Source-quality review stayed on Flash, passing both quality suites
in the Gemini run and one of two in the other runs; those failures were not
attributed to the comparison candidates.

All 66 synthetic requests were priced, costing $0.034634084 in total. No real
memory was sent. Candidate compatibility and current catalog pricing were
checked against primary documentation; the recommendation rests on measured
results, not general model claims. Neither the generation model nor a deployed
configuration was changed. The two OpenAI models were reference candidates,
not a migration recommendation.

Verification: 84 targeted API unit cases passed, API typecheck passed, and
whitespace checks passed. The live evaluation correctly remains failing at
its accuracy/false-novelty gate. The ordinary environment still cannot enable
the test-only model override. The raw numeric decisions and cost/timing data,
with corpus and prompt-source hashes, are saved in
`docs/craft/evidence/top-of-mind-novelty/20261029-judge-comparison.json`; the
readable comparison and caveats are in `docs/plans/top-of-mind-novelty.md`.

The full Vitest harness required a provisioned database even for model-only
cases. The initial attempt against a nonexistent local test database stopped
before collecting tests or making model calls. A disposable database was then
created on explicitly verified 127.0.0.1 for harness provisioning:
`waka_novelty_increment15_test_20261029`. It was removed afterward. No shared
database, account memory, migration file, app server, persistent worker or
schedule was changed. No recurring DB pings were added. Changes remain local
and unpushed; existing `work/` artifacts are untouched. Logs are in
`/tmp/waka-increment15-*`.

Next review: the focus criterion. Gemini's merged-case proof covered all
content, then mistook compaction for changed leading focus. Test whether
matching the leading theme, separately from whole-reading information, fixes
that case without weakening actual theme-switch, question or time-scope
detection. Preserve the frozen labels and false-positive gate.

## Core-logic review, increment 16 (2026-10-29)

Status: owner-selected Top of Mind synthesis model changed locally; not deployed.

Top of Mind synthesis now defaults to `openai/gpt-6.1-terra` with medium
reasoning. Signal extraction, support and matching, the independent Top of
Mind publication review, Principles, reflection, Review and chat retain
`deepseek/deepseek-v4.1-flash-1017`. The experimental semantic novelty
comparison stays disabled. The complete task/model/override inventory is in
`docs/generation.md`. API and worker share the explicit deployment synthesis
pin; a missing or blank per-task override also selects Terra locally.

The first live requests exposed Terra's strict-schema requirement: every
object property must be required, with optional fields explicitly nullable.
Only Terra synthesis uses that encoding; the existing parser normalizes
nullable optional values back to absent domain values. Terra reasoning also
omits sampling temperature. The 8,192-token response cap, citations,
selected-language requirements, human locks and publication guards remain
in force. No generation prompt or quality threshold was loosened.

Verification: 1,059 API unit cases passed (9 opt-in live cases skipped),
53 targeted SQL quality/refresh/floor cases passed, API typecheck and
whitespace checks passed. Live synthesis reached Terra and independent review
reached DeepSeek. The Korean fixture published with owned citations; the
English publication fixture was refused for grounding and synthesis quality.
A separate synthetic English diagnostic produced valid structured output and
passed DeepSeek's language, grounding and synthesis review. The original
English publication failure remains recorded; this is routing/compatibility
verification, not a claim that all live quality cases passed or that Terra's
quality is established by these samples. The temporary diagnostic test was
removed rather than entering the ordinary suite.

The six received live responses reported a total cost of $0.006519294.
Three earlier schema-error requests did not report prices; their cost is
unknown. All inputs were synthetic. SQL ran only against explicitly verified
127.0.0.1 and disposable database `waka_terra_switch_test_20261029`, removed
after verification. No migration, shared memory, app server, persistent
worker, schedule or recurring DB check was added. No deployment or push was
performed. Existing `work/` artifacts remain untouched. Logs are in
`/tmp/waka-terra-switch-*`.

Next review: a frozen English/Korean corpus for Terra synthesis paired with
the existing DeepSeek publication judge. Measure source grounding,
cross-inspiration synthesis, language, unsupported traits, merged repetition,
false rejection, cost and latency. Keep the failed publication sample visible
and keep the separate semantic novelty gate disabled until its own criteria
pass.

## Core-logic review, increment 17 (2026-10-29)

Status: requested image/review routes changed locally; audio migration held by
owner after a measured failure. Live generation/OCR quality remains open.

Top of Mind language, grounding and synthesis-quality review now uses its
own `WAKA_MODEL_TOP_OF_MIND_REVIEW` setting, defaulting to
`openai/gpt-6.1-terra`. Synthesis keeps Terra with medium reasoning; the
classification-style review uses low reasoning inside its unchanged
2,400-token cap. Signals keep DeepSeek. API and worker share both explicit
Top of Mind pins. The experimental semantic novelty comparison remains
disabled and independent of this setting.

Image descriptions/OCR for PNG, JPEG, WebP and GIF now use
`deepseek/deepseek-v4.1-flash-1017` through the shared OpenRouter transport.
Private image bytes stay inline; existing privacy restrictions, bounds, safe
errors and cost recording apply. HTTP status is available to the image
adapter to preserve its transient/permanent retry distinction. HEIC/HEIF
stay on Gemini because OpenRouter documents only the other four formats;
without an OpenRouter key the existing Gemini vision fallback remains.
There is no fallback after a configured provider fails.

OpenRouter's current catalog lists DeepSeek with image/text input and no
DeepSeek audio-input model. The owner selected Voxtral Mini Transcribe 3 as
an audio alternative. A bounded prototype passed monolingual English,
Korean, numbers, silence, tones and English/Korean M4A/WebM fixtures, but
dropped the English half of a mixed-language WAV (normalized CER 68.9%).
Adding Mistral's context-bias option did not repair it; a separate segment
response also contained only Korean. The failed readings were retained.
The owner then explicitly chose to keep Gemini active. Both audio source
files were restored; no Voxtral route/configuration is active. Its adapter
and tests survive as an inactive patch and synthetic measurements under
`docs/craft/evidence/media-model-routing/`.

Live results are mixed, and are not an all-green acceptance claim. Medium
Terra review passed 12/14 fixed cases, with two false rejections and no false
acceptances. Low reasoning passed all 14 of the same fixed cases without
changing prompts, labels or thresholds. Both English/Korean end-to-end
publication fixtures were still refused by source-quality guards in both
runs; their generation-quality issue remains open. DeepSeek OCR recognized
the fixed marker in two runs but later returned ANTEMMA for ANTENNA. The
active Gemini transcription adapter passed all ten audio/container checks,
including mixed-language speech. These are synthetic voices and images,
not physical microphones, noisy-speech measurements or a model benchmark.

Verification: 1,075 API unit cases passed (9 opt-in live cases skipped), 70
targeted attachment/transcript/reading SQL cases passed, API typecheck and
whitespace checks passed. A reusable opt-in synthetic adapter check is in
`tools/e2e/media-model-routing.ts`; it uses prepared speech from
`tools/e2e/audio-transcription-eval.ts` and ffmpeg for phone containers.
Synthetic transcripts and hashes, all failed measurements, review counts
and numeric usage totals are retained in the evidence directory. Unpriced
Gemini usage is not assumed free. Temporary diagnostics were removed.

SQL used explicitly verified 127.0.0.1 and disposable database
`waka_media_terra_test_20261029`, removed afterward. No shared/account memory,
migration, server, persistent worker, schedule or recurring DB ping was
changed. Nothing was pushed or deployed; existing `work/` artifacts were
untouched. Diagnostic logs are in `/tmp/waka-media-terra-*`.

Next review: inspect the rejected generated English/Korean readings against
their cited originals and signals, especially inferred interests and causal
claims. Separately evaluate OCR spelling across providers and ordinary photo
formats. Keep the failed cases and existing grounding/language/citation
requirements. Resume the Voxtral migration only after a design for preserving
every spoken language passes the mixed-language case.

## Core-logic review, increment 18 (2026-10-29)

Status: comparison bugs fixed and grounding boundary clarified; experimental
novelty remains disabled while the legacy benchmark is adjudicated.

A later exact duplicate could incorrectly override a valid comparison of the
leading entries and manufacture a focus change. Whole-content witnesses and
the leading pair now have separate decisions. A review rejecting every entry
also formerly called an empty comparison unchanged; it now fails explicitly.
Both defects were reproduced by failing tests before the implementation fix.

Source diagnostics explained the causal legacy example's rejections: the Save
source observes hesitation, but the Close source describes an expectation,
not an observed benefit. The publication prompt now explicitly allows a
supported abstraction across originals while keeping expectations,
observations and outcomes distinct. Shared subject matter and hedging do not
supply evidence for new causal benefits. No labels or requirements changed.

Eight independent semantic boundary cases passed; three clean merged/split/
later-duplicate cases passed real source review and comparison after the
clarification. Fourteen English/Korean source/language cases passed, including
invented outcomes/motives, decorative citations and wrong-language optional
fields. The frozen corpus stays unchanged: the first broad pass was 12/13 on
the original labels and 12/14 overall, with the disputed split/merge cases
still failing. Its legacy quality/integration failures remain recorded.

Verification: 1,077 API unit cases passed, API typecheck passed. All 48 live
responses were priced, costing $0.072197. Inputs were synthetic; no database
was provisioned, read or changed. No worker, timer, recurring DB ping,
deployment or push occurred. Temporary diagnostic code was removed. Existing
`work/` artifacts were untouched. Logs are in `/tmp/waka-merged-logic-*`.
The full rubric, per-phase failures, diagnostic rationales, hashes and
measurement limitations are in `docs/plans/top-of-mind-novelty.md` and
`docs/craft/evidence/top-of-mind-novelty/20261029-boundary-review.json`.

Next review: adjudicate whether replacing explicit saving/returning with
broader navigation preserves all required information. The causal positive
examples also need to match the evidence they actually supply. Keep legacy
failures visible, and do not enable the experiment until a reviewed corpus
passes novelty, real source-quality and language gates together.

## Cut after review (do not re-try without a design)

Storage-event reads vs sends, focus re-sends with a persisted `sentAt` / 30s rule, polling on
`save_in_progress`, treating `save_request_conflict` as a refusal (it can mean the id landed — a
duplicate path), a "gone from disk" scan mode, and in-memory pressed ids. Each round of these found
a new duplicate or a stuck `busy`.
