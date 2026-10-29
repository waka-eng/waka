# The four-layer data model

**Status: canonical.** Decided 2026-08-15, revised same day to make
**profiles** first-class (owner + assistant review of the waka/waka-mcp
integration); **amended 2026-08-18 to add the fourth layer, principles**
(goal: `goals/principles.md`). This document is the vocabulary of record
for WAKA's data system. When code and this document disagree, the code is wrong — either
fix the code or amend this document first. New concepts land here before
they land in a schema.

Breaking changes are currently acceptable: no backward compatibility, no
legacy aliases. One name per concept, everywhere — DB, code identifiers,
API surface, MCP tools.

This document covers *what the layers are*. The generation mechanics —
exactly how signals are derived from inspirations and the top of mind from
signals, with every threshold — live in [generation.md](generation.md),
whose numbers are machine-checked against the implementation in CI.

---

## Accounts and profiles

An **account** is the auth identity: one login (email/Google), one person.

A **profile** is the unit that owns memory. Every profile — human or
agent — owns a full four-layer stack: inspirations → signals → top of
mind → principles. There is exactly one top of mind **per profile**;
principles are a growing set per profile.

- Each account has one **human profile**: the person's own memory.
- Each account can have **agent profiles**: separate stacks that agents
  use as *their own* memory (observations, lessons, working knowledge).
  The schema supports N agent profiles per account (each typed and named);
  the UI lists each named agent profile separately.
- The human is admin of every profile in their account: they can see and
  edit everything, including an agent profile's memory.

Agent separation is **structural, not a lens**: an agent's own memory
lives in its own profile, not as filtered views over the human's data.
(The earlier lens-board design is superseded by this.)

Browser drafts and the remembered capture visibility choice are scoped to
both account and profile. Changing identity discards the previous identity's
in-memory page state and ignores its late responses. Unattributed legacy
device drafts remain unassigned; a new sign-in must not silently claim or
display them. Completed reflections remain server-owned inspiration detail,
while unfinished drafts belong only to their authenticated storage scope.
An unfinished re-recording keeps the existing clip and a separate owned
`recordingCandidate` in the local draft. It is not a second inspiration or a
second uploaded attachment. Choosing a clip atomically replaces or discards
the candidate; only the chosen recording enters the immutable save manifest.

The human profile's language setting also updates its owned agent profiles and
queues a separate reading refresh for each changed profile. Agent credentials
can change only their own language. Generation still preserves locked human wording.

### Archive summary snapshots

Personal archive summary snapshots are an in-memory read optimization, not a
memory layer or generation input. `GET /api/inspirations/snapshot` authorizes
the target profile exactly like archive reads and returns a fingerprint of the
exact total and newest 2,000 source identity/personal-material-revision pairs
from one repeatable-read snapshot. It returns no raw words or evidence. A
missing material revision refuses cache reuse. Summary DTOs carry the same
`materialRevision`; no second revision counter is introduced.

The `inspiration-snapshot-v1` digest binds profile, total, wire order and
material revisions, never a Top of Mind/generation revision alone: uncited
originals can change without affecting that generation fence. Browser caches
are bounded, account/profile-scoped and memory-only, revalidated before reuse,
and cleared on identity changes and attempted source mutations, including lost
write responses. Full originals are fetched again when opened. Cached wording
is never proof of current machine evidence, authorization or public sharing.

Signal lists may opt into `include=inspirations` to receive current supporting
`inspirationIds` from the already-validated support edges. This is identity-only
metadata for private human/agent profiles, never quotes, reasons or group
members' source identities. Group profiles omit it. It lets the field preserve
its relationships without fetching every signal's full evidence; the visible
reading's full roots are fetched and validated separately.

### Archive search

The web archive requests 50 summaries at a time and follows the cursor only
when more are requested. An optional `includeCategories=true` list query
returns the target profile's category names independently of the current page.
Category names never include another profile's material.

Search-result previews may be remembered in memory for the mounted account
and profile (up to three queries of 500 rows each). They render immediately
on return while their loaded pages refresh. They are display state, never
current evidence: opening an inspiration still reads its full original.
Source-write attempts invalidate reuse; account changes discard the owning
view objects. An authorization failure clears remembered results; an ordinary
refresh failure explicitly labels the previous results and offers Retry.

Archive search matches the requested profile's original text, non-skipped
saved answers and current effective attachment material. A corrected recording
replaces its machine transcript. Storage object URLs are not searchable words;
original link URLs remain searchable. Matching never broadens profile access.
An optional exact category filter applies before counting and pagination, so
searching within a category includes older matching originals as well.

`inspirations.text_search_vector` is an internal projection of that row's raw
text, with `text_search_vector_policy` identifying the parser policy. Policy 1
is PostgreSQL `to_tsvector('simple', text)`. It is not a memory layer, a second
source identifier, a material revision or evidence. No vector is exposed in a
summary/detail DTO, shared to a group or fed to generation as source wording.

A database trigger synchronizes the projection on insert and text writes in
the same transaction. Old rows may have no projection; an unsupported policy
also refuses reuse. Both cases fall back to matching current raw text rather
than omitting an original. Reflection/media candidates are read from current
owned child rows, not cached into this raw-text projection, so their edits,
removal, pending enrichment and transcript corrections take effect directly.

The additive migration leaves historical vectors empty instead of rewriting
the archive under a long migration lock. An explicit operator command fills
them in bounded, resumable batches against a verified local/dev target.
Backfill changes only search metadata: it must not advance material/generation
revisions, queue model work, rewrite human words or change generation policy.
There is no repair work on reads. Source removal removes its projection with
the original row. Keyset cursors retain PostgreSQL timestamp precision so
captures sharing a microsecond timestamp do not disappear between pages.

### Credentials bind to a profile

Native consumer sign-in acts as the account's human profile, never an agent.
`mobile_login_codes` is transient authentication infrastructure, not a memory
layer. It stores a SHA-256 code hash, the authorized human profile, exact app
identity, S256 PKCE challenge, a hash of the app's state and a two-minute expiry.
Exchange atomically consumes only a valid matching code and creates its human
session in the same transaction. Reusable session credentials never appear in
callback URLs. Google browser identity resolution remains shared with web
sign-in; the mobile handoff does not use the CLI's profile-selection flow.

Every session acts *as* exactly one profile:

- The browser session acts as the human profile (admin over the account).
- A CLI/MCP credential is minted **bound to one profile**, chosen during
  the loopback login's consent step. An agent using WAKA as its own memory
  logs in bound to its agent profile; audit and revocation are
  per-profile.

### What an agent session may do

A session bound to an agent profile gets (isolation ruling, 2026-10-22):

MCP connections use separate credential directories and an expected profile ID.
Login with a requested profile must bind exactly that profile, never silently
fall back to the human profile or another agent. The client verifies the actual
session profile before accessing memory; server authorization enforces the same
boundary even for direct requests. Historical read grants do not widen it.

| Target | Allowed |
|---|---|
| Its own agent profile | Full read/write: capture, curate signals, edit its top of mind, declare and curate its own principles |
| The account's human profile | No access: an agent connection reads and writes only its bound profile |
| A sibling agent's profile | No access, including when an older `agent_read_grants` row exists |
| Other accounts | Nothing |

The human-profile session can do everything in every profile of the
account. Enforcement is server-side, keyed off the session's bound
profile — this is the concrete shape of the CLI-session scoping planned in
the auth-hardening track.

### What a keeper-key session may do

The one exception to "the human session is the account's admin": a session
resolved from a **keeper key** (below) is bound to the human profile but
carries `keyScoped`, and gets exactly two verbs on exactly one profile —
**read and capture on its own**. Keep an inspiration; read the four
layers; nothing else. No curation (an inspiration kept through the key is
edited at a browser), no other profiles (not even the account's own
agents), no account decisions (`humanSessionsOnly` refuses it). The scope
is enforced twice, deliberately: a positive route allowlist at the
`requireAuth` chokepoint (`keeperKeyMayPass`), and the `keyScoped` branch
of the access matrix underneath — a standing credential in a config file
on disk must not be the account's admin, however it is presented.

A keeper key can identify and verify its own binding through
`GET /api/auth/me`, `GET /api/profiles` (self only) and
`POST /api/auth/cli/verify` (matching profile only). These exact endpoints
support MCP setup; they cannot start a login, mint credentials or administer
profiles. Account and sibling memory remain inaccessible.

Since 2026-10-15 the key has one more verb: it may **propose** sentences to
the harvest basket (`POST /api/harvest`, below). Proposing is not deciding:
reading the basket, keeping and letting go are `humanSessionsOnly`, so a
key's own collector never approves what it gathered.

---

## Private conversation foundation

A `conversation` belongs to one profile, outside the four memory layers. Its
`conversation_messages` are ordered, immutable messages with explicit user or
assistant authorship. Sending a message does not create an inspiration, signal,
principle or feedback verdict. Replies require `WAKA_CONVERSATION_REPLIES=1`;
otherwise saving has a zero-call budget. When enabled, Send commits the user
message and reply request in one transaction, so a lost response cannot strand
the message between saving and enqueueing or duplicate it on replay.
The first Send may create the conversation, its first authored message and
that reply request in the same transaction. Opening a new-chat composer does
not create an empty conversation. Client-generated conversation/message IDs
survive uncertain outcomes; a changed first-message replay conflicts.

The selected profile owns its chat list, messages, drafts, and saved takeaways,
as well as its memory layers. Agent chat links carry the profile ID so reloads
retain that owner. New chats use that profile's memory alone. Changing the
selected profile never moves an existing conversation or merges its messages.

A conversation may start from an owned, currently readable Principle via
`initial_principle_id`. This prioritizes the current wording in context without
inventing a user message. Its profile-bearing foreign key clears only the source
ID on deletion, preserving conversation history. Merely opening a conversation
does not request a reply.

`conversations.perspective` (migration 0075) says whose memory the replies
stand on: `mine` (the owning profile's saves, and every chat before the column),
`agent`, or `both`, each source labelled with whose it is. `agent_profile_id`
names which agent and is set only when the chat is started by the account's
human profile with one of that account's agents; anything else is refused.
The ownership is checked again on every read, and if the agent is gone
(`ON DELETE SET NULL`) or no longer the account's, the chat quietly reads the
person's own memory. This explicit perspective mechanism is retained for
existing human-owned conversations; the profile-scoped UI starts new chats with `mine` and does not
automatically read another profile's memory.

For a chat owned directly by an agent profile, `mine` still means that owning
profile. The reply input labels its sources as agent memory and describes them
as that agent's records, not the human's biography or work performed by WAKA.
This attribution does not change the stored perspective or borrow human saves.

Milestone 6 adds `conversation_reply_requests`, separate from user messages.
One pending/running reply is allowed per conversation. An initial request or
explicit retry compares the last request ID under the conversation lock: a
replayed retry joins its successor instead of dispatching twice. Each attempt
may dispatch at most one query embedding and one answer; ambiguous failures
require a new, explicit retry, which may incur a new provider charge. Limits
are three attempts per user message per hour and twenty reserved provider slots
per account per hour. Both slots are reserved before a hybrid attempt; a stopped
or failed lookup does not refund that reservation. With only one slot left,
the answer uses lexical context rather than exceeding the limit. Answers have
at most 1,200 output tokens. Dispatch timestamps survive
conversation deletion until profile erasure so deletion cannot reset the budget.

Stop is a publication fence, not a promise to undo provider billing. New messages,
memory changes, deletion and lost worker ownership prevent late publication.
The final source check and reply insert hold the selected memories' generation
revisions and the selected raw inspirations' material revisions. Raw captures
need their own fence because they can enter chat before forming any signal and
therefore need not advance a profile's generation revision when edited. These
locks exist only in the final transaction, never across a provider call. A busy
editor wins rather than waiting back on its source row; the message and paid
dispatch record remain, with an explicit retry required after failed publication.
Replies cite numbered current sources with verified quotes; persisted reference
metadata contains only source identity and a content/state hash. Historical
assistant words whose references changed are labeled and excluded from future
generation. They are conversation history, not new personal memory. Deleting
the conversation erases those words and reference metadata. Source access is
revalidated when opening a citation; no stale copied excerpt is served.
`context_sources` stores only the selected source identities/hashes, separate
from the citations actually used in the answer. It is null for older attempts
without selection metadata; new attempts record even an empty selection.
The retained context API revalidates that selection; the current UI does not
expose the former memory drawer or a separate citation list. Conversation deletion erases
both sets of reference metadata while retaining the budget timestamps.

Client-generated conversation/message IDs make retry idempotent. A replay with
different content conflicts rather than overwriting words. Deleting a
conversation erases its messages and keeps only a content-free conversation
tombstone, so delayed retries cannot recreate it. Profile/account erasure removes
the tombstone too. Profile export includes active conversations and their messages.
Messages reference their conversation with a profile-bearing foreign key.

The initial limits are 100 active conversations per profile, 200 messages per
conversation and 4,000 characters per user message. Context reads are bounded to
16,000 text characters and freshly select only that profile's current readable
Principles, live Top of mind and keyword-matched owned inspiration material.
Questions about changes in thinking can additionally read earlier Top of Mind
records. The reader uses up to three live entries plus one different entry from
each of at most two earlier versions, scanning at most three superseded
meaningful artifacts and fourteen earlier entries. Ordinary questions remain
live-only. No-change audits and exact copies of current wording do not become
evidence of a change. Earlier records obey the same owned, current-support and
human-wording policy as the private history surface; unsupported machine words,
dismissed entries and deleted evidence are not revived.

An earlier record carries its artifact publication date and version. That date
does not prove when a belief changed or when a later human edit happened.
Chat compares supplied earlier/current wording tentatively, and abstains when
the selected records cannot support the requested comparison. The UI labels
earlier sources with their record date before selection and on reopening.
New reading-reference proofs use `reading-v2`, binding complete wording,
revision, entry identity, human lock, current support, publication date and
artifact version before excerpting. Supersession alone preserves that proof;
old text-only proofs remain valid only against the same currently readable
owned words. Reply references record whether they were already historical when
cited, so deliberate use of history is not immediately marked changed. A
formerly current source becoming historical still marks the old reply changed.
These are optional fields in existing JSON metadata, not a new memory layer or
a database migration. Historical date labels and selected-source messages use
the UTC record date, matching the supplied model dates across device timezones.

Conversation reads validate unique source identities once per read rather than
once per assistant message. Three-identity chunks preserve the original excerpt
allowances; each citation still checks its own current or legacy proof. Legacy
inspiration references retain both original-text and enriched projections where
needed. No source cache survives the request, and per-message historical/stale
status is preserved. At most 200 message groups and three citations per group
are accepted. The 200-message conversation limit remains. Browser reads request
the latest thirty messages initially, then expand the loaded span by thirty
positions on explicit request. Every refresh revalidates the loaded span.
`messageWindowStart` is a response boundary over immutable message positions,
not another message identity or stored revision. Total `revision` remains the
write fence; partial DTOs must be contiguous through that total revision.
Legacy requests without window parameters still receive the complete thread.
Writes validate against the full conversation, and a replay response includes
its original message confirmation even outside the requested tail. Invalid
write windows roll back. Uncertain-write recovery first checks current state,
then expands only when later messages hide its expected confirmation position.
Session scroll metadata remembers the account/profile/conversation-scoped
loaded boundary, never raw words; legacy scroll records restore the full span.

Material includes saved reflection answers and ready link/image/audio text;
an audio correction replaces the original transcript rather than adding a
second account of it. Excerpts distinguish human reflections from generated
descriptions. At most six inspiration candidates are selected, with 1,600
characters per source and 4,000 inspiration characters in the reply context.
The bounded reader includes at most three reflection and three attachment
passages per source and marks omissions. Short continuation queries may reuse
the preceding substantive human topic, never an assistant's unadopted claim.
New citation identities include the personal material revision; old plain-text
citations retain their original text-only identity and offsets. Ranking,
contested state, human wording and unconfirmed support stay explicit; stale
machine claims and deleted originals are not retrieved. Context is never a
cached copy in the conversation and must be rebuilt before future generation.
When current-model personal embeddings are available, the worker can combine
lexical matches with semantic matches and a diversity penalty. Selection
abstains on weak uncorroborated similarity: the existing 0.6 floor is
used with keyword support, otherwise 0.65. Candidates remain near the strongest
match (within 0.03, or at least 0.75); unindexed lexical matches remain available.
These chat-only values were selected by the recorded retrieval comparison,
not applied to signal derivation or Principle eligibility. Query embedding
runs outside DB locks, with a five-second header and ten-second total deadline;
Stop and source changes are rechecked before answering. The scan uses at most
500 most recently indexed owned personal vectors, validates at most 24 candidates against
current canonical input, and selects at most six inspirations. Canonical checks
are capped at 12,000 characters and 16 contributing children per type; oversized
or stale material is not admitted through the semantic path, but can still match
lexically. This is a bounded selection, not a claim to inspect the entire archive.
Embedding failure falls back to lexical context. Migration 0065 adds selection
metadata, lookup accounting and the bounded-scan index before this worker runs.
Natural-language retrieval quality requires the separately recorded evaluation;
synthetic-vector tests alone do not establish it.

### Selected thoughts from a conversation

Only an explicit capture creates an inspiration from chat. A user message can
be selected and edited; an assistant suggestion stays in the conversation until
the person writes and confirms their own takeaway. Unadopted assistant text is
never sent to the inspiration learning pipeline. Saving does not edit a Principle.

`inspiration_conversation_origins` records `user` or `adopted` authorship and a
tenant-bearing link to the selected message. It stores no copied chat excerpt.
The normal capture receipt binds the full request, including the selected span
and explicit adoption, so retry returns the same inspiration. Chat captures are
private at creation. Deleting the conversation clears its provenance link but
keeps the deliberately saved inspiration and authorship; deleting the inspiration
removes its provenance. Profile export includes provenance, and account erasure
removes it. Ordinary inspiration editing does not relabel its historical origin.

### Conversation corrections

A correction is a new user message with an optional `corrects_message_id`
pointing to an earlier assistant message in the same profile/conversation. It
does not rewrite history, create memory or edit a Principle. Reply context labels
the correction and prioritizes the current user view over earlier interpretations.
For an ordinary deliberate correction, the provider and citation parser omit
saved sources rather than rearguing them. An explicit comparison request keeps
those sources. This does not erase memory, rewrite earlier messages or change
past receipts. The current reply records no selected saved sources and skips
query embedding; an explicit comparison retains normal retrieval.
Principle editing is a separate confirmation of exact wording and its observed
`statement_revision`. A stale edit conflicts; an exact retry of the immediately
applied revision is a no-op. Existing statement history and human locks apply.

## Operational monitoring

Normal queue work is pushed on enqueue, with bounded asynchronous redelivery
and a daily safety sweep. The development fifteen-minute recovery timer was
removed on 2026-10-15 because its idle queries repeatedly woke the serverless
database. There is no periodic recovery heartbeat or missing-heartbeat alarm.

When Scheduler is configured, `packages/api/src/lib/background-job-wake.ts`
creates only self-deleting, one-time `at(...)` schedules for actual queue work:
one pending wake per profile/deadline group, and a watchdog for a claimed job's
15-minute lease. The watchdog is armed before provider work; a scheduling
failure releases the unspent claim as a support hold. Completion, source
deletion and profile/account erasure cancel recorded timers after settlement
or commit. A still-running original lease keeps its watchdog if settlement
failed. No source words or credentials enter the schedule payload.

Each pending group has a fresh token. A replacement cancels the old generation;
late or duplicate deliveries cannot drain an armed newer generation. Deliveries
recheck profile, exact deadline or lease/attempt, request version and current
status before ordinary claims. Invalid or early events do not run models.
A full recovery batch schedules one continuation only after proving that
unarmed work remains; an empty queue never schedules a successor. Recovery
runs after activity, an explicit inspection or the existing daily sweep.
Scheduler transport retries and Lambda async retries are bounded, not a poll.
Missed delivery still has the daily fallback; cloud timing, cancellation and
notification delivery require deployed verification.

An explicitly invoked recovery inspection can still use the claim predicate
and a five-minute grace from `run_after` or lease expiry. It takes at most five
overdue claims in one pass, retaining fairness, account budgets, request
identities and attempt ceilings. Exhausted stale leases are reported for
operator intervention rather than automatically revived.

An inspection emits stage-level overdue counts, oldest overdue age, exhausted
leases and a check count. The two passive backlog/exhausted-work alarms do not
query the database and treat missing samples as non-breaching. Notifications
require an explicit SNS topic. The development deployment verifies through
EventBridge reads that the worker's daily sweep is its only recurring trigger;
job-specific Scheduler events must use `at(...)`, never `rate(...)` or cron.

Local queue drains and maintenance commands are one-shot; the local API only
sets a timer for a known supported pending job and stops when no work remains.
No hourly maintenance or seconds-based drain loop runs from `dev:local`.

`background_job_runs` (migration 0082) is account-scoped operational metadata,
not memory: opaque job ID, request version, attempt and start timestamp. A claim
and its run record commit together. It preserves throughput accounting across
job reuse and source/profile removal. It has no raw words or credentials, no
job/profile FK that could refund spent work, and an account FK that cascades on
account erasure. Holds refund only their own claim. Records older than two days
are removed by existing daily maintenance; they create no timer or poll.

Ordinary job failures are retried with backoff (three attempts by default;
repeated malformed output can stop earlier), then retained as failed with a
sanitized `last_error`. The daily sweep does not automatically revive terminal
failed jobs. Worker summaries and generation diagnostics are logs, not delivered
owner notifications. The recovery alarms above sample explicit recovery
inspections, not every terminal failure. There are no configured API-error or
browser-error notification paths in the application infrastructure; render
boundaries report to the browser console. Owner alert delivery and a real
failure/recovery exercise remain production gates in `docs/goals/beta-readiness.md`.

Model transports emit numeric attempt, token and billing metadata without
prompts, responses, vectors, credentials or account IDs. OpenRouter's returned
`usage.cost` is recorded when finite and nonnegative. Missing/invalid cost and
ambiguous failures remain unpriced, never free. Gemini token metadata is
recorded without invented dollar estimates. Dimensions are only stage/provider,
with closed operation labels as ordinary log fields. These metrics observe
spending; they are not a dollar-cap enforcement ledger or proof of provider
retention settings. Per-environment limits and alert recipients require explicit
configuration and deployed verification. Existing call/job budgets still apply.

Operator checks distinguish configured facts from unverified deployment facts.
Runtime verification accepts only the stage's explicit HTTPS API/web origins,
production cookie settings, stage/model tags and no fixture-address overrides.
It does not attest proxy topology, database isolation, provider privacy or
monetary limits. No URL, key label, credential or provider failure body is echoed.

OpenRouter requests support restrictive opt-in policy: data collection may be
denied and zero retention required. Unset preferences leave account policy
untouched; no request disables an account-level restriction. Invalid policy is
refused before dispatch, and missing eligible routes do not trigger a silent
provider fallback. Gemini policy is separate. Source code or a synthetic routing
probe does not establish deployed settings or contractual retention behavior.

## The four layers

| | Layer 1 — **Inspiration** | Layer 2 — **Signal** | Layer 3 — **Top of mind** | Layer 4 — **Principle** |
|---|---|---|---|---|
| What | Raw capture: text, links, images | Distilled, durable pattern derived from inspirations | The synthesized artifact: what currently matters | How the profile chooses, stripped of context — a directive that survives its situations |
| Created by | Humans and agents (per the permission matrix) | WAKA server (background generation) | WAKA server (generated from signals) | WAKA server (nightly, from long-lived signals) + owner declarations |
| Modified by | Owner-profile admin; captures are editable and deletable | Curated/edited by the profile's admin; mainly machine-made | Edited by the profile's admin (personal) / members together (group) | Owner only: declare, edit (locks), reorder (sticky rank), delete, dispute |
| Cardinality | Unbounded list per profile — editable, deletable, **not** append-only | Evolving set per profile | **Exactly one** per profile; exactly one per group | Growing, **uncapped** set per profile — expensive to earn, merged on overlap |
| Visibility | Private to the owning profile's account | Private by default; shareable per group — the unit walls consume | Profile: account (+ optional public surface); group: members | Account-private; **not shareable** (v1); served to the profile's own credentialed tools via the canonical machine rendering |

The pipeline, per SPACE, and the rules are the same in every one of
them: a space's ground is what is visible in it; a space's signals are
distilled from its own ground; a space's top of mind is those signals
after people have acted on them — alone in your own space, together in
a room. For a person: inspirations accumulate → WAKA distills signals →
signals synthesize into the top of mind → what keeps surviving
distills, nightly, into principles.

**A room runs the same pipeline over a pooled ground** (founder ruling,
2026-08-24: "that room should create signals based on x+y+z"). A room's
ground is its members' public memories — x from one person, y from
another, z from a third — and the room distils ITS OWN signals from
them, owned by the room's mind (a `group`-type profile, migrations
0024/0025) rather than by any member. Three rules keep that honest:

- **Visibility stays global and two-valued.** One switch — private, or
  public to every room its owner is in. Per-room visibility is
  deliberately out of scope.
- **A room's signal appears only once memories from at least two
  different members stand under it.** A pattern one person's memories
  support is that person's own signal, already forming on their own
  wall, and must not wear the room's name — everything a room says
  about itself is genuinely collective.
- **The evidence asymmetry is deliberate, and it is not a global
  relaxation.** A ROOM's entries may name the memories that fed them,
  because a room's ground is public-to-the-room by construction — every
  memory on it was put there by its owner's own switch. **Your own top
  of mind keeps "that, never which."**

The room's top of mind is generated from the room's own signals through
the same synthesis pipeline, still gated by the members' affirmations
and proposals. Sharing an already-formed personal signal into a room
("say out loud") retires as the way statements reach a room — the
`signal_shares` record survives as history (the export still carries
it; the record outlives the verb), but the wall's future is what the
room grew. Principles do not participate in groups (v1).

## Inspiration (layer 1)

### Personal capture extension approved 2026 10 02

The owner approved recorded audio as an inspiration input and one composer for
text, links, photos and recordings. An inspiration may have empty authored text
when it has attachments; presentation labels must not be stored as invented
human prose. A bundle save identifies one immutable intent and commits its
inspiration, attachment rows and processing request atomically after uploads.
Replaying it returns current owned data without creating another attachment.

Audio is an attachment kind. Its original bytes remain separate from
`audio_transcription` enrichment, stored as the attachment's machine-derived
enrichment text. New audio captures request the existing durable enrichment job;
valid completed transcripts are reused for the same attachment. No intelligible
speech is unavailable material, not invented words. The
`transcript_correction` is separately authored content that machine retries
must never overwrite. Null selects the machine transcript; an empty correction
explicitly means no usable words. The attachment's `transcript_revision` changes
when transcript processing or the correction changes; clients compare this
number when editing, and workers reject results prepared before such a change.
`transcript_corrected_at` records the explicit owner action. Effective attachment
material prefers the correction for extraction, embeddings and source checks,
without promoting it into a second inspiration. Correction changes invalidate
stale quotes/vectors and request learning in the same transaction. Export and
erasure include original transcript and correction with their attachment.
Explicit enrichment retries are limited to three per attachment per one-hour
window beginning at the first explicit retry (`enrichment_retry_count`, `enrichment_retry_window_at`),
in addition to existing worker attempt and account budgets. Joining already
pending work consumes no new retry; exhausting this window never removes the
original recording or the person's correction. Link/image preview recovery and
whole-inspiration recovery use this same budget, not an alternate retry path.
Original audio, transcript and answers from the same capture do not establish
independent repeated experiences.

The approved later review/conversation/export contracts are detailed in
[the personal capture contract](plans/2026-10-02-capture-foundation-contract.md).
The current avatar review offers collector picks and current signal verdicts;
its ordering and repeat rules are in [generation.md](generation.md#review-what-waka-asks-and-when).
The inspiration-review UI was removed. The session storage/routes below remain
for compatibility, retained answers and owner export; they are not a second
current UI journey. The opt-in conversation reply contract is specified above. Review skipping is
session-local, a review selection is not a verdict on a principle, and multiple
source references do not multiply one authored response. A selected principle
may be explicitly exported as an image under that contract; this extends the
earlier no-sharing v1 rule only to the user's chosen artifact, not public access
to principles, inspirations, answers or audio. Export-only wording edits do not
rewrite the underlying principle.

The review implementation contract uses `review_sessions` and `review_items`.
A session belongs to one profile and stores its stable id, creation-input hash,
revision, cursor and optional completion time. A profile has at most one open
session. Items reference both `(profile_id, session_id)` and
`(profile_id, inspiration_id)`, keep a fixed position and the material revision
at session creation or the latest acknowledged choice, and hold a nullable
`keep`/`skip` choice. Read-only viewing does not change that revision. They never copy source text.
Source deletion removes its item by cascade, without inserting a replacement
or changing the remaining order. Current revision is checked when a choice is
written; stale tabs cannot overwrite a newer session decision. A repeated
create uses the same session id and input hash rather than creating a second
review. Review metadata is exported and cascades with the profile.

The retained review API selects one inspiration at a time. New suggested
sessions contain one source, prioritizing those without a
saved reflection or prior review choice, then newest first. Sources with a
confirmed review choice or authored, nonblank, unskipped reflection in the last
24 hours are held back; eligible revisits rotate by oldest engagement first.
Explicit legacy manifests retain their
five-source bound and original order so old sessions and request replays remain
valid. A new inspiration never changes an open session's fixed manifest.

Single-inspiration reflection uses the existing `reflections` rows and their
owner-scoped save/recovery protocol, not a cross-source `review_answers` row.
Follow-up questions use only that inspiration and its reflection thread. Next
records session progress (`keep` when a saved reflection exists, otherwise
`skip`), completes an exhausted session and opens the next suggested original.
Next is never deletion or a verdict on a signal/principle. Closing preserves
the open review and unfinished reflection drafts. Opening Home only reads the
resume state; entering Review explicitly starts the session, with no model call.

Review reads/start may opt into `include=current`. That response includes only
the current owned inspiration and its `materialRevision`, read with the review
cursor/revision and children in the same repeatable-read transaction. The
client checks owner, identity and material revision before using it. Home's
resume read stays metadata-only. Replacing `/review/new` with its committed ID
retains that confirmed response; unrelated navigation, identities and explicit
refreshes still revalidate. An empty start may report whether originals exist,
without an extra client-side archive count or any generation work.
An older API's rejection of the opt-in query may negotiate a read-only legacy
fallback before starting. A rejected or uncertain POST is never automatically
replayed for compatibility; its durable identity and explicit recovery remain.

Current APIs advertise `supportsAdvance`. Explicit Next uses one atomic
`/advance` request to save its versioned choice, complete an exhausted session
and create the next suggested single-source review. The response includes that
current owned original, not a prefetched or cached copy. A client-generated
next session ID and its creation-input hash bind the previous session, observed
revision, source revision and choice. Repeating the same request returns its
existing successor rather than skipping again; an empty successor result cannot
start a later capture on replay. Legacy multi-item manifests advance within
their fixed order first. Conflicts or creation failure roll back the transition.
The browser journals the intent before posting, retains a confirmed bundle
through the route change and reconciles a lost response with scoped reads.
Older APIs retain the existing multi-request flow without an automatic write
retry. No inspiration is deleted or model work created by Next.

Removal is the existing permanent inspiration deletion, including its server
reflections, attachments and evidence links. Review requires confirmation and
sends the observed personal material revision. The DELETE route checks that
revision under the source lock and rejects a changed original before mutation.
Unversioned existing delete clients remain compatible. A lost delete response
is reconciled with an owned GET, never an automatic second DELETE. This is not
a recoverable archive; the UI must not offer an undo it cannot honor.

Historical cross-source answers, their cited links and unfinished device drafts
remain accessible/copyable; they are not rewritten into per-item reflections.
The following R05/R08 contracts describe that retained historical pipeline,
not the default Review interaction.

R05 uses one profile-owned `review_answers` row per authored response and
`review_answer_sources` links to the reviewed items and their material revisions.
A one-source answer has one focused (`referenced`) link; a cross-source answer
has several, not several copies of the words. Context-only links also record
every input the model saw, so an uncited input cannot bypass invalidation.
`source_count` records that full context set's original size. The same generated-question job may receive only
one answer, and the answer's client id/input hash make response-loss replay safe.
Generated questions live in metered `generate_review_question` jobs, cite only
the current kept sources, and are served only for a matching context hash.
Opening or checking a review never queues a question. Explicit requests are
limited to three per context per hour, in addition to worker/account budgets.
Each attempt retains its own budget record; invalidation clears its content
instead of deleting that record. Status reads compare source revisions and
answer history without reloading attachment bodies.

Human answer text survives source edits/removal as private session history.
If a referenced source changes or its link disappears, generated question text
is redacted and the answer context is marked invalid. Those historical answers
are not silently reused as current grounded dialogue. Editing or removing an
earlier answer also redacts later AI premises that may depend on it, while
preserving the later human answers. Explicit answer removal clears its words,
AI context and links, retaining a minimal deletion receipt so a lost-response
retry cannot recreate it. Deleted answers are absent from history and export;
account/session erasure removes the receipts too. Export includes live answers
and their remaining source links.
These rows do not yet feed signal/principle generation: R08 must establish
lineage-aware evidence behavior before that integration. Selections or multiple
links never establish multiple independent experiences by themselves.

R08's integration contract keeps review support distinct from raw inspiration
support: a generated claim must cite actual owned human answers and their
current revisions, not the AI question or the keep/skip choice. An answer is
never copied into each inspiration's material. Support extraction, reassessment,
withdrawal and display must preserve that source kind; the runtime integration
is not enabled yet.

Independent support has two limits. An inspiration (including its attachments,
transcript and reflection) contributes at most one witness. All answers in one
review session contribute at most one review witness to a given signal. A
review witness names only its focused source origins, not context-only inputs.
One origin cannot be spent twice across direct and review witnesses. Counting
uses a maximum one-to-one matching between witness units and eligible origins,
preferring direct inspiration witnesses and then older review witnesses with
stable id ties. This preserves independently supporting originals: reviewing
two established witnesses together does not merge them into one. Repeated
replies or a replay cannot manufacture additional independent origins.

Counting does not establish semantic support: only already-validated witness
rows enter this calculation. A direct witness uses its inspiration's creation
time; a review unit uses the earliest supporting human answer's creation time
for its matched focused origin,
never the oldest contextual source date or an edit/retry time. The existing
promotion threshold and confidence/Principles coefficients are unchanged.
All count, confidence, recency and longevity consumers must use the same
selected units before review support is enabled. This bounds what can be
claimed from stored provenance; it does not infer a person's unrecorded lived
experiences or equate an `experience` workspace label with an independent event.

Review support is stored as `signal_review_evidence`: one metadata relationship
per signal and human answer, with tenant-bearing signal/session/answer foreign
keys, statement and answer revisions, source count and whether the then-current
AI question was included as context. `signal_review_evidence_sources` records
the current material revision and focused/context-only role of every allowed
source read in that assessment. It references the answer's original source
relationship as well as the evidence relationship. These are assessment-time
versions, distinct from the question-time versions in `review_answer_sources`.
No answer, question, quote or generated reason is copied into these tables.

A changed source or earlier answer withdraws the old AI premise immediately.
Reassessment may still use surviving self-contained human words against current
allowed material, without restoring that premise or assuming positive support.
No surviving focused origin means no eligible review witness. An answer edit,
deletion, context change or support-link mutation must fence in-flight generation;
old relationships cannot be served merely because their ids still exist.
Only the owning personal/agent profile may receive this support, never a room.
The review support producer remains unfinished until its queue, reassessment,
read projections and promotion guard share this contract.

The producer uses `review_signal_support` for the last version-bound assessment
of an answer/claim pair and its last explicit positive or negative verdict.
An unresolved follow-up cannot erase an earlier withdrawal. The metadata carries
no source words. `review_answer_processing` binds a source fingerprint and one
numbered background request to completed derivation and an eventual reading
request; queued work is not completion. Both belong to the answer's profile,
export as private metadata and cascade with that profile. Deleted answers keep
only the existing minimal tombstone; neither retries nor metadata receipts may
recreate their words. Implementation and semantic verification remain in progress.

Answer writes and relevant source/statement changes transactionally request
`derive_review_answer` work. A pass first reassesses existing support, then
discovers new statements from the person's complete answer. AI questions and
original attachments are context, not newly authored evidence. A committed
withdrawal survives a later discovery failure. Review candidates require a
semantic match verdict even above the raw inspiration cosine attach threshold;
negated or time-limited positions must not merge merely because vectors are close.

`review_model_runs` records the owning profile, claimed job and lease timestamp
immediately before a review attempt's first model request. It carries no words.
Replaying a committed result does not spend another slot; another lease that
calls a model does. Job deletion clears only its reference, preserving the
account's window usage. Profile erasure removes these private records and export
includes them. This is a bounded-attempt meter, not token billing; other job
types retain their existing start-based meter. Result-job and run-job foreign
keys carry the profile and use partial SET NULL in migration 0059.

A review reading result is recorded in the artifact publication transaction.
Finishing extraction later preserves that exact artifact id and version,
including when the queue row has been removed. A newer numbered answer request
withholds the older result until the current work completes. A session result
is ready only when every surviving answer has completed; an earlier answer's
result cannot stand in for pending answers. Explicit recovery resumes the
unfinished stage without saving another answer or generating another question.
The result may be changed, unchanged or empty. Related Principles are existing
owned rows whose current citations include this review; session completion
itself does not create a Principle.

### Existing inspiration behavior

A capture event. Whatever arrived: pasted text, a link, an image, an
agent's relayed excerpt, an agent's own observation.

- **Editable and deletable.** Editing an inspiration re-derives the
  signals it supports. Deleting one removes its evidence links; a signal
  that loses all evidence is retired — unless human-locked, in which case
  its text stays and it is marked unsupported.
- **Provenance is recorded at capture**, two facts kept distinct:
  - *which session captured it* (the bound profile — audit), and
  - *whose initiative the content is*: `source: "app"` for
    human-directed content (their words, relayed or typed), `source:
    "agent"` for agent-initiated content. Since the 2026-08-29 ruling an
    agent-bound session cannot save into the human profile at all, so a
    human stack gains `source: "agent"` rows only from history predating
    the ruling; an agent's own stack is where its observations live.
- Inspirations carry a **`visibility`** of `private` (the default, at the
  column level) or `public`, chosen by the person who saved it and editable
  in both directions afterwards. Only `public` ones cross an account
  boundary, and only into the rooms that person's account belongs to —
  there is no world-readable capture. A room's *field* is exactly this: the
  public captures of its current members, each carrying whose it is.
  Closing one again removes it from every room at once, since no copy is
  made anywhere.

  This reverses the original rule ("inspirations never cross an account
  boundary; only signals are shareable"). A room that could show only the
  machine's readings of what people keep, and never what they actually
  kept, was a thinner room than the product wanted. The gate is per capture
  and never inferred.

  What is still absolute: **evidence never crosses**. A signal's evidence
  names the exact spans of the memories behind it, and sharing a statement
  has never shipped its grounds. A consequence worth knowing: a shared
  statement may cite memories its author kept private, so a room can show a
  statement whose grounds are not all visible in that room.
- Attachments (links, images, files) hang off the inspiration.
  **Enrichment** is machine-derived capture-time context stored with the
  attachment and never presented as the human's words: a link attachment
  gets a bounded, deterministic fetch of the page (title, description,
  bounded text); an image attachment gets a one-time vision description,
  cached on the attachment and re-derived only if the attachment
  changes. Enrichment exists so layer-2 extraction can read what the
  human *saved*, not only what they typed.
  Successful link/image/audio material is reused on worker replay; a slower
  attempt cannot replace committed success with a failed read. Source ownership,
  source identity and worker claims are rechecked before reuse or publication;
  audio transcript revisions still fence human corrections. Enrichment and its
  learning request commit together. Document files (PDF, Office, text files)
  are stored for opening, with analysis marked unavailable; they are not parsed
  into memory automatically.
- **Reflections** — the short Q&A a human attaches at capture (or later)
  — are layer-1 detail on the inspiration: kept, human-authored, and
  input to personal extraction. Guided follow-up questions use saved answers
  as context. Answers remain personal even when their parent inspiration is
  public: publishing a capture does not publish its reflections.
  Generated follow-up questions also belong to that personal context. Before
  saving one, the worker locks the profile's generation-revision row, reloads
  its exact consumed capture/recent-answer/locale context, and verifies its job
  claim in the same transaction. Changed context or a reclaimed claim cannot
  publish the old question. Unrelated reading/signal changes do not invalidate
  an unchanged question context or spend another model call. Source redaction
  holding the question job wins; generation retries without deadlocking it.
  If a worker saved a question but stopped before queue settlement, a new
  owner may reuse it only after validating its current owned context and
  current question format. Review questions also revalidate every source ID.
  Lost claims are refused before question dispatch, not only at commit.
- **Embedding input scope** separates `personal` material (including answers)
  from `public` material (capture and attachment context, never answers).
  `inspiration_embeddings.input_scope` is part of the vector's identity with
  inspiration and model. Both scopes belong to the capture's owner. Room
  retrieval must never use a personal vector, including legacy vectors.
- **Inspiration save requests** make authored capture/answer submissions
  reconcilable after an ambiguous response. An optional UUID `Idempotency-Key`
  identifies one intent within the target profile. `inspiration_save_requests`
  has a composite `(profile_id, request_id)` primary key; it records the operation,
  a normalized input hash, the created source/answer references and original
  processing metadata in the same transaction as the authored rows and jobs.
  It stores no duplicate words, attachment content, or response-body snapshots.
  Reusing the key for the same operation/input returns the current owned item
  without another write; changed input or operation is a conflict. Concurrent
  submissions share a transaction-scoped request lock; an in-flight conflict
  is retryable, never reported as committed. A missing lookup is not proof that
  an earlier network request cannot still commit.
  Live output links use tenant-bearing composite foreign keys. Deletion clears
  those links and processing metadata before the parent is removed, retaining
  the request/hash as a tombstone until profile erasure. A replay of a removed
  item returns Gone rather than resurrecting it. Replays read current permitted
  material, not stale words from the first response. Historical requests are not
  backfilled or expired into reusable keys. Keyless clients retain the ordinary
  non-idempotent create contract; the browser must preserve one key per pending
  intent, not invent a new key on every retry.
  The browser journals the pending authored input and UUID locally under its
  account/profile (and parent inspiration for answers) before sending. This is
  temporary draft/recovery material, not a stored server-response snapshot or
  generation receipt. Reopen/focus checks are read-only; an explicit retry may
  resend the unchanged intent. Matching drafts settle before the pending record
  is removed, newer drafts survive, and continuation happens after cleanup.
  A save binds its words, selected attachments and draft identity/revision at
  the Save press, before asynchronous storage flushes. Only its own upload
  receipt writes can advance that submitted revision; human edits cannot.
  Each file's presign and upload have a two-minute transfer deadline; failures
  preserve the original bytes and earlier completed receipts for retry.
  Settlement compares revisions after cleanup;
  identical words do not make a newer draft the submitted one. Text-only saves
  retain this identity when IndexedDB is unavailable, relying on the durable
  local save journal rather than claiming file storage succeeded. Removed-save
  reconciliation also awaits draft settlement before releasing the journal.
  The bounded save deadline covers settlement as well as network requests.
  Async settlement checks the active save attempt after each wait, so a late
  cleanup cannot change a newer draft or finish an already superseded retry.
  A newer draft retains its words and new attachments, while cleanup removes
  uploaded object tickets consumed by the confirmed save (or its removed-save
  tombstone). One uploaded object belongs to one attachment; retaining that
  ticket would make the next inspiration conflict. Cleanup is durable before
  the pending save identity is released.
  Validation rejection permits editing; an ambiguous response does not release
  its identity. Corrupt records are never auto-submitted; a confirmed reset
  preserves uninterpreted bytes in a separate, never-auto-adopted recovery key.
- **Inspiration material revisions** distinguish changes to one source from
  changes to a profile or an artifact. `inspiration_revisions` holds personal
  and public counters for that inspiration, advanced transactionally by source
  mutations. Capture and attachment material advance both; usable private
  answers advance only personal material. No-op/timing-only writes do not move
  them. Counters begin at the rollout baseline, not a reconstructed history;
  they contain no source snapshots and imply no completed processing.
- **Inspiration processing** binds source material to a destination profile.
  Each `inspiration_processing` receipt binds one numbered request to its source
  material revision, with the source owner's tenant-bearing FK. Derivation and
  completion are recorded separately on that receipt; latest derived/completed
  revisions can be read from those facts, never inferred from queued work.
  Reprocessing unchanged material creates another receipt, not inherited success.
  Numbered reading requests and an artifact result explain the next stage.
  Source deletion removes this metadata too; no private text is copied into it.
  `derived_at` is written only after a successful, current source pass, not
  queue acceptance. Transient support failures and pending/failed enrichment
  do not certify derivation. Changed standing binds an exact numbered reading
  request; an unchanged pass retains earlier unfinished dependencies, recovering
  failed/missing reads instead of silently dropping them. Genuine no-change
  work without such a dependency may settle against the current artifact.
  Publication records its artifact result in the same transaction. A result
  arriving during extraction is retained, but `completed_at` waits for both
  derivation and the required read while material/permission are current.
  Superseded revisions, withdrawn room material and departed members cannot
  gain a new completion. Completed receipts are historical facts, not promises
  of perpetual support after later edits. Recovery can reuse an already committed
  derivation/result without purchasing another extraction/synthesis.
  Personal processing status is a read-only, profile-scoped snapshot: an owned
  receipt may follow newer material or a later request, but partial publication
  and legacy success are never called completed. Status contains identifiers,
  counters and an owned artifact result, not source words or provider errors.
  Explicit recovery resumes only missing/failed work, preserving active work
  and scheduled holds. Reading-only credentials are not offered recovery.
  The browser keeps one account/profile-scoped metadata reference in session
  storage and boundedly checks status without displaying processing progress or
  recovery controls. Confirmed completion revalidates the owned artifact before
  updating an idle Home screen; open pages and editing are not interrupted.
  Neither a timeout nor an unconfirmed status installs new wording.
  Removed/inaccessible sources withdraw the metadata reference. Actual save and
  load failures remain visible; background failure recovery belongs to the owner.
  Room processing remains an internal destination fact, not a new way to expose
  a member's private source-processing state to the room.
- **Signal input policy** records the derivation contract, not user approval.
  `signals.input_policy = group-public-v1` means the room signal was minted
  using the public projection, authorized current membership, and only
  same-policy context/match targets. Legacy null-policy room signals are
  unverified, not automatically safe because new evidence matches them.
  Preserve them for reviewed historical repair; do not carry them into new
  generation. Personal signals have no room input policy.
- **Derived room output carries the same policy** on
  `top_of_mind_entries.input_policy` and `principles.input_policy`. Current
  safe citations alone cannot certify wording generated from older context.
  Unverified generated output is withheld from reads and prompts, not deleted.
  Protected entries continue in the stored version chain while withheld.
  A locked entry whose exact body was explicitly proposed and accepted by the
  room may expose that approved body; unverified generated belief/prompt text
  and unavailable citations are not included. Approval is permission to share
  those words, not proof that their old machine explanation was safe.
- **Room reads are permission-sensitive snapshots**, including historical
  versions. The browser revalidates on return/focus and while the room is
  active; current room bundles and principles have a 30-second maximum cache
  lifetime. A changed projection at the same version is still a change.
  Restriction metadata crosses the HTTP client intact; failed or expired
  verification removes cached shared content, without deleting server records
  or personal drafts. Superseded reads cannot restore an older snapshot.
- **Background completion is separate from queue acceptance.** A
  `background_jobs.result` receipt records a completed top-of-mind artifact
  ID/version and whether the pass changed content, held its reading, or had
  nothing to synthesize. It contains no source text. The owning worker writes
  it with completion; a pending rerun exposes no completed receipt. Status
  reads are profile-scoped. This job receipt does not replace the source
  revision/provenance contract needed for downstream evidence reconciliation.
- **Evidence material identity** records the scope, policy and content hashes
  of the source IDs a derivation read, without retaining source text snapshots.
  `signal_evidence.material` is that immutable description; null marks legacy
  lineage, not a newly verified source. A quoted answer also names
  `quote_reflection_id` (constrained to the same owner and inspiration) and
  `quote_source_hash`. A quote must occur in one actual source, never across
  concatenated answers. Source changes are checked under locks after model
  decisions and before writes. Changing/deleting a source removes copied
  quotes and generated reasons; it does not itself assert that the broader
  claim is false. Explicit support assessment remains a separate operation.
  Deleted reflection content is not retained in generated follow-up job
  payloads. Human-authored signal/entry/principle wording is not erased by
  this source-copy cleanup.
- **Support review is distinct from extraction.** A read-only review asks
  explicitly about each existing signal/inspiration link against that
  inspiration's complete current allowed material. `supported`, `unsupported`
  and `unresolved` are internal assessment outcomes, not public product states.
  Missing/duplicate/invalid verdicts, unavailable providers, incomplete source
  material and budget limits cannot authorize withdrawal. Related inspirations
  cannot supply evidence for the source being checked. Reports retain hashes,
  IDs and verdicts, not answer copies or generated explanations. Stale reports
  resolve nothing and no report alone authorizes a write. Automatic support
  assessment now runs before bounded discovery during derivation, with one
  bounded support call per attempt and reuse only for identical material,
  statement and `signal_support_reviews.policy`. A genuine unresolved answer
  remains distinct from an unavailable or malformed response; the latter asks
  the worker to retry. Explicit operator reviews can force a fresh assessment.
  Applying any review must revalidate material, statements, membership and
  prior assessments under transaction locks. `signal_support_reviews` retains metadata-only decisions,
  including unresolved checks, never withdrawn quotes or answer snapshots.
  Only explicit unsupported decisions remove a current `signal_evidence` link;
  supported decisions may restore it from current material. Discovery omissions
  and unresolved reviews do neither. `signals.support_retired_at` distinguishes
  retirement from lost support (recoverable on renewed evidence) from a human
  dismissal or a merge (never reversed by a support check). Repeated application
  of the same review is a no-op. Standing reconciliation and the downstream
  reading request commit with the evidence change, not as a best-effort callback.
- **Statement edits durably request support review.** Human signal edits and
  reverts commit wording/history, removal of the old vector, re-embedding,
  one `review_signal_support` job per existing or previously withdrawn owned
  witness, and a reading request together. This review job checks existing
  claims against current material without extraction or vector discovery. It
  has its own source/destination key and uses the same worker budget and
  current-input/claim fences. It never certifies an inspiration's full
  derivation or completes its source-processing receipt. An identical edit
  of already locked words adds no history or generation request.
- **Current support is revision-bound.** `signals.statement_revision` advances
  on every actual wording change, including change-and-revert. Evidence binds
  `statement_revision` and the allowed source's `material_revision`; artifact
  and principle citations bind the statement revision they consumed. Changed
  inputs make a link pending without deleting it or asserting the claim false.
  Only a current positive assessment or grounded new discovery renews evidence;
  new artifact generation renews its own citations. Missing legacy statement
  stamps refer only to the migration baseline (revision one), never the latest
  wording. Existing exact material identities may provide their recorded
  revision; missing material lineage is not filled with the newest counter.
  Protected wording remains readable with changed support and without stale
  generated explanation. The baseline preserves prior standing, not proof of
  historical semantic review or a completed historical repair.
  Cached support verdicts also bind the statement and material revisions;
  identical text after an intervening change cannot renew an earlier verdict.
  Entry body and principle statement revisions similarly bind citations to
  their owning words. Editing those words retains their old citation records
  as non-current lineage; regeneration can ground the new words with new
  bindings without restoring copied explanations from the previous wording.
- **Bounded review coverage continues as work, not failure.** When a source has
  more unchecked claims than one support call can cover, the coordinator queues
  `assess_signal_support` jobs of at most the review batch size. Each paid batch
  is a separately metered job, bound to material, membership and statement
  revisions. Reports explicitly name their selected claims; they cannot apply
  a verdict outside that set. Discovery waits for complete current coverage.
  Provider faults still use bounded retries, and genuine unresolved verdicts
  complete assessment without withdrawing evidence or starting a retry loop.
- **Source writes durably request learning.** Capture, inspiration edit,
  reflection save/removal and attachment finalization commit their queue rows
  in the source transaction. Enrichment rechecks the attachment resource after
  fetching and commits its cache and personal/public-only fan-out together.
  Discovery commits its reading request with its evidence changes. Worker wakes
  happen after commit and may fail without losing the saved work. Creation and
  edits share one source/destination job key; a newer request survives even an
  exhausted older attempt. Deletion locks the source, reconciles all citing
  destinations, cancels obsolete source jobs and persists reading requests in
  one transaction. None of this makes a held or unfinished reading complete;
  source-to-artifact completion receipts and full downstream fences remain
  separate requirements.
- **Generation revision** is a per-profile, monotonic invalidation token in
  `generation_revisions`, not another public reading version. Relevant source,
  evidence, statement, feedback, artifact and principle changes advance it in
  the same transaction. A room's token also covers membership/proposals and
  public member metadata; private reflection changes advance only personal
  dependencies. Generators capture the token before reading their inputs and
  lock/recheck it after model calls, before committing any output. This catches
  changes even when text changes back to its earlier wording. It stores no
  source text and does not by itself prove current-output validity or learning
  completion. Worker-driven reading/principle commits also check and lock their
  job claim; input freshness alone does not authorize a reclaimed worker.
  Principle comparisons finish before the batch transaction starts, and a
  busy human-edited principle makes generation retry rather than wait back on
  the person's row. A human edit still owns its wording.
  Worker-driven reading publication also commits its eligible principle request
  in that transaction; failed handoff rolls back publication rather than leaving
  the next layer unscheduled. This schedules principles, not certifies that they
  have already been generated.
- **Worker claims guard data writes, not only job settlement.** Capture-vector
  writes, applied support reviews, discovered evidence/signals, enrichment caches
  and pattern-comparison records check the claimed job inside their own write
  transaction. Source jobs first verify that the referenced capture/attachment
  belongs to the job's profile. Reclaimed work cannot mutate data or enqueue a
  downstream reading as part of that transaction. Valid earlier stages remain
  committed if a later stage loses its claim; a job is not one giant transaction.
  Pattern comparison prepares all judgments before its batch write, verifies
  the generation revision, and respects decisions recorded while it was waiting.
- **A job request is numbered independently of its job ID.** `request_version`
  advances when new work joins a reusable queue row; a claim carries the version
  it began with. Only successful owned settlement advances `completed_version`,
  and only through that claim's version, even when newer work is waiting. A
  retry or cadence hold is not completion. API versions are decimal strings.
  These numbers identify queue requests, not source material or artifact
  versions. Legacy completion is unverified (zero), never backfilled by guessing.
- **Personal feedback context stays in its profile.** Personal synthesis uses
  feedback on that profile's own signals and entries. Reactions to another
  profile or room remain stored for that context; they are not permission to
  fetch that target's later, potentially private wording into personal prompts.
- **Room feedback input is current member stance, not private correction text.**
  Room synthesis receives each current member's latest verdict on current room
  signal wording. Its context is bounded after per-member deduplication and
  word/access filtering. Personal free-form correction bodies remain private
  and are never copied into a room prompt.
- **Feedback belongs to the words that were judged.** `feedback.target_revision`
  binds a verdict to the signal/principle statement or entry body revision read
  when it was recorded. New writes capture that revision under the target's
  write lock; a supplied revision must match or the write is refused. Changing
  words, including changing back, does not transfer previous verdicts to the
  new wording. Unstamped legacy verdicts refer only to revision one, not the
  latest words. History remains available to its reader; current confidence,
  feedback markers, room reactions and synthesis use matching revisions only.
  A separately stored owner decision, such as keeping a principle under review,
  survives until explicitly changed; a wording change is not an implicit undo.
  Personal synthesis also excludes feedback context about unsupported generated
  targets;
  an explicitly held entry remains the person's words, not renewed proof.
  Verdict, immediate standing changes and their required reading jobs commit
  together. A failed queue insertion cannot leave an accepted but unprocessed
  correction behind.

## Harvest candidates (before layer 1)

`harvest_candidates`, added 2026-10-15 (migration 0072). A sentence of the
person's own, picked from their work by a collector they run, waiting for
them to keep it or let it go. It is **not an inspiration** and nothing in
the four layers reads it: no extraction, no top of mind, no principles.

- **Proposed** by the human profile's own sessions, the keeper key
  included, into that profile only. Agent profiles are refused: since
  2026-08-29 agents do not write into the human's material, and the basket
  is not a way around that. At most 30 wait at once. The same sentence,
  normalised for spacing and case (`source_hash`), is proposed once.
- **Kept**: the client saves the words through the ordinary
  `POST /api/inspirations` (the candidate id is the save request id when the
  words are unchanged; corrected words are a new save with their own id),
  then `POST /api/harvest/:id/keep` records which inspiration it became.
  The basket's copy of the words is deleted; the hash stays.
- **Declined**: the words are deleted in the same write. A reason may come
  with it or once afterwards: `not_mine`, `already_kept`, `private`,
  `trivial`, `miscut`, or `other` with the person's own words in
  `reason_note` (1–280 characters, and only with `other`; migration 0073).
  The hash stays, so a refused sentence is not proposed again.
- **Lapsed**: seven days unchosen. The words, the title and the hash are
  deleted when the basket is next read; the sentence may be proposed again.

A CHECK holds that `text` is present exactly while the status is
`pending`. `context` describes where a candidate came from (tool, project,
hour, position, mode) without any of its content. Erasing the profile
erases its basket.

## Deleted inspirations (the shelf beside layer 1)

`deleted_inspirations`, added 2026-10-15 (migration 0074). Deleting an
inspiration still deletes it — the row, its evidence and every signal
reconciliation happen exactly as before — and, in the same transaction, a
copy of its words, kind, category, source, visibility, reflections and the
date it was kept goes onto this shelf under the inspiration's own id. Nothing
that reads `inspirations` has to learn to skip a deleted row.

- **Every owned profile.** A human browser session can recover its own and
  its agents' deleted inspirations, including captures with only attachments.
  Agent sessions and API keys cannot access this shelf; their deletes remain permanent.
- **Thirty days** (`DELETED_KEEP_DAYS`). Expired copies are removed on reads,
  deletes and the daily sweep; restore never finds an expired copy.
- **Routes**, human browser sessions only, scoped by optional `?profile=` to
  an owned profile: `GET /api/inspirations/deleted`,
  `POST /api/inspirations/deleted/:id/restore`, and
  `DELETE /api/inspirations/deleted/:id` (permanent removal).
- **Attachments are retained** with their metadata, transcript corrections and
  stored files in a JSON snapshot (`attachments`, migration 0080). Restore
  reuses their ids and the inspiration's original id and date. Stored objects
  remain reserved while deleted, and are swept on expiry or permanent removal
  only when no live attachment or other deleted copy references them.
- Legacy copies with `had_photo` but no attachment snapshot can restore text
  only; the UI and restore response explicitly say their attachments are gone.
- **Restore revisions never restart.** Migration 0081 retains the deleted
  source's `personal_revision` and `public_revision` as bigint floors. Restore
  advances each independently above its saved floor, even with a repeated or
  backwards clock. Exports encode these integers as decimal strings. Legacy
  copies default to zero because their old revisions were not recorded; the
  epoch-millisecond fallback remains, but cannot recover an unknown old floor.
- Signals and the reading are regenerated. Experience, decision citations and
  conversation-origin links are not restored.

Erasing the profile erases its shelf; the profile export includes it.

## Experience (layer-1 grouping)

The named ground a run of memories was gathered on (meeting decision,
2026-08-17 — deliberately **experience**, not "project": a project is a rule
scope, an experience is a stretch of lived work). One row per
`(profile, name)`, born at capture: naming an experience on a keep
finds-or-creates it in the capture's own transaction, so there is no second
birthplace to drift from.

- **An inspiration names at most one experience**, through a composite
  `(profile_id, experience_id)` FK — the same tenancy net every child of
  layer 1 uses, so a memory can never stand on another profile's ground.
- **Signals are deliberately NOT keyed to experiences.** A signal's relation
  to an experience is a fact of its *evidence* — which memories stand under
  it and where they were kept — so it is derived by joining
  `signal_evidence → inspirations → experiences`, never stored twice.
- **The lens**: `?experience=` on the inspirations and signals lists narrows
  recall to one ground; `GET /api/graph` draws
  principle → signal → experience from the same joins, statements and names
  only — capture text never crosses.

## Agent keys

The standing credential an agent profile holds (meeting decision,
2026-08-17: per-agent names and API keys). Issued and revoked by a
**human session only**; binds to an **agent profile only**; resolves through
`requireAuth` to an ordinary agent-bound session, so the access matrix and
`humanSessionsOnly` apply unchanged — a key is a way in, never a wider set
of powers once in. Only the secret's SHA-256 lands in `agent_keys`
(sessions-table posture); the secret is shown once at issue time. Revocation
is a timestamp and takes effect on the key's next request. Agent and keeper keys have
no automatic expiry; each profile can hold five live keys. Issuance counts and
inserts under its profile lock, so concurrent requests cannot exceed the cap.

## Keeper keys

The mirror credential for the person (founder ask, 2026-08-29, completing
that day's ruling: with agents unable to capture into the human profile,
the person needs a first-class way to keep from their own MCP). Same
posture as an agent key in every mechanical respect — `waka_keeper_` +
48 hex, SHA-256-only at rest in `keeper_keys`, prefix for telling keys
apart, header-only (a key in a cookie is not a credential), revocation as
a timestamp effective on the next request, issued and revoked by the
unscoped human session only (a key cannot mint its successor). What
differs is the binding and the power: it binds to a **human profile
only**, re-checked at lookup so a hand-forged row cannot re-point it at an
agent, and the session it resolves is `keyScoped` — keep and recall on the
person's own memory, nothing else (matrix section above).

**An evidence-backed pattern**: a durable distilled statement — a taste,
a theme, a tension, a belief — that cites the profile's inspirations as
evidence.

- **M:N evidence**: one signal cites any number of inspirations; one
  inspiration can support any number of signals. New inspirations
  strengthen existing signals (more evidence, higher confidence) or spawn
  new ones. Signals are *patterns*, not per-capture fragments.
  Similarity retrieves a nearby match; changed wording still needs a semantic
  judgment before sharing evidence, including above the normal attach bar.
  Negation, certainty and time scope must remain distinct. Within one reply,
  only identical wording is deduplicated before matching. Vectors whose input
  hash no longer matches the statement cannot match or suppress candidates.
  Dismissal suppresses the same meaning, not every neighboring topic. Within
  the current bounded anchor scan, identical wording takes priority and needs
  no model call. Otherwise the nearest dismissed statement above the existing
  similarity bar receives one semantic check: only `same` suppresses;
  `independent` or `opposed` continues ordinary discovery without reviving the
  dismissed signal or creating a dispute with it. Missing, malformed or declined
  judgments fail the attempt rather than inventing a verdict. All decisions
  precede source locks; current anchors and source revisions are rechecked
  before writes. Restore stops future suppression, without replaying historical
  refusals automatically. Nothing here creates a timer or periodic DB read.
  Signal wording follows the capture's language; the profile language setting
  governs the Top of Mind reading. Recording transcripts are labeled as source
  material without assuming the speaker's views belong to the profile owner.
- **Server-generated**: the background pipeline (classification,
  embeddings, the context graph) exists to produce and maintain signals.
  Those mechanisms are internal machinery; the signal is the product.
- **Human-curated**: the profile's admin can edit a signal's statement,
  merge, hide, or delete it. A human edit **locks** the signal (see the
  edit rule).
  Re-embedding loads current wording and reuses a matching model/input hash.
  After a provider call it locks and rechecks the statement and worker claim
  before changing the cache. A slow success cannot replace a newer vector;
  a slow failure cannot delete one. Only that model's mismatched cache may be
  removed, and missing output is retried through the normal bounded queue.
  A concurrent human edit takes priority over a waiting embedding writer.
- **The shareable unit**: sharing is a per-signal, per-group choice. A
  shared signal appears on that group's wall as its distilled statement.
  Its evidence (the underlying inspirations) stays private — members see
  the pattern, never the raw captures.
- **Disagreement, in three words** (no-quiet-corners Phase 5). A
  **tension** is two patterns held on purpose — both true, pulling against
  each other; it is layer-3 material, never a defect. **Contested** is an
  unresolved conflict: the three-way merge judge answered *opposed* in the
  ambiguous band, the new signal minted anyway, and an undirected
  `contradicts` pair (`signal_contradictions`) holds the dispute — both
  sides serve as contested until arbitration. Resolution comes **only from
  an owner act** — a lock, a verdict (`true` settles for the answered
  side, `not_true` against it; `partly` settles nothing), or a dismissal —
  never from evidence weight, however lopsided (founder ruling 2026-08-23,
  decision log below). The loser becomes **yielded**: a state read off the
  resolved pair at serve time, its row and evidence untouched. A state,
  never a deletion.

## Top of mind (layer 3)

The single synthesized artifact answering "what currently matters, is
believed, and is in question" — for that profile. A human profile's top
of mind is the person's ambition mirror; an agent profile's is the
agent's distilled working memory.

- Composed of **entries** (individual statements/questions/tensions), but
  the artifact is the unit: one identity, one current version, a linear
  version history. Regeneration produces a new version; nothing is
  mutated in place.
- **Profile-scoped**: generated from that profile's signals; the admin
  can edit entries (which locks them), pin, dismiss, reorder.
- **Derived, not quoted**: each machine entry connects at least two distinct
  inspirations through its cited signals and speaks the profile's selected
  language. Several signals from one original are still one inspiration.
  Copied wording and wrong-language machine entries do not survive a refresh,
  including a model's `noChange` response. A separate publication review checks
  the actual language and whether distinct cited originals meaningfully support
  the connection, not merely whether citations exist. Rejected replies retry
  without replacing a valid reading; human-kept wording remains exact.
  New entries must cite only signals offered from that profile; any invalid
  citation rejects the whole entry. Publication review samples across cited
  signals within its existing source budget. Cosmetic machine echoes are
  removed on generated and no-change versions; human choices remain verbatim,
  including deliberate duplicates. Signal diversity compares current wording
  hashes only within the current embedding model's coordinate space.
- **Human choices precede publication.** Proposals repeating dismissed words
  or retyping human-kept words are removed before source review. A valid first
  machine entry may fill a truly empty reading despite an incorrect
  `noChange` hint. A reading containing human edits remains a meaningful baseline.
  Semantic novelty comparison remains an inactive experiment:
  its live accuracy gate failed. Normal refreshes use the existing synthesis
  hint and exact persisted-content comparison; no new schedule or recurring
  database read is enabled.
- **Current support is projected when read.** Personal current and historical
  version reads check the entire citation set against standing, owned evidence.
  A retired, dismissed, unsupported, missing or foreign-evidenced signal cannot
  support a current conclusion. Unkept machine text with any invalid citation
  is withheld, not salvaged by silently trimming its citations. Locked/pinned
  wording survives with `supportChanged`; stale generated belief/prompt text is
  cleared and only current citations are returned. Stored history is not erased
  by this projection. Public profiles apply the same rule, recheck both sharing
  flags when fetching content, and return no private identifiers or sources.
  This describes current standing, not verification of legacy lineage or proof
  that a pending source/statement edit has completed semantic reassessment.
- **A reading check does not generate.** The private version endpoint rechecks
  the displayed version with its `profileId` and `generationRevision` from one
  database snapshot. The browser rejects older snapshots, cancels on identity/
  view changes and pauses checks while editing. A failed check retains the last
  reading and offers a GET-only retry. A separate explicit reread requests
  generation. The revision orders reads; it is not a source-completion receipt.
- **Group**: generated from the room's OWN signals — distilled from the
  pooled public memories of its members (ruling 2026-08-24; previously
  from signals members shared in, whose record survives as history).
  Entries can attribute contribution. Members change it together —
  proposals and affirmations are the co-editing mechanism — and
  accepted changes create new versions.

## Principle (layer 4)

`principle_generation_steps` holds private processing receipts. Each model
dispatch records its target profile, billing profile, input/step identity and
outcome; the job link carries the billing tenant in its composite foreign key.
Completed results support bounded resumption and are not new human evidence.
A publication receipt commits with the Principle changes and supports recovery
without rewriting later human edits. Old result bodies are cleared while recent
dispatch timestamps preserve account limits. Profile erasure removes the rows;
owned profile export includes them. Reading a page does not create these steps.

**How the profile chooses, stripped of context.** A **rule** binds a
context ("≤$100 for LLM testing") and is checkable; a **principle**
survives having its context removed ("have something working before you
put more money in") and *compiles into* different rules per context.
WAKA stores the generator; captured rules are **evidence, never
artifacts**.

- **Five qualification tests**, all required for a minted principle:
  *context* (still instructs with every proper noun and number deleted),
  *directive* (prescribes the next choice; a fact about the person is a
  signal), *evidence* (cites ≥3 signals with distinct normalized statements
  from this profile's own history), *support* (dated evidence and representation in ≥1 top-of-mind
  versions), *completion* (can never be finished; anything checkable-off
  is a goal). Exact thresholds live in
  [generation.md](generation.md) and are drift-locked once implemented.
- **States**: `held` (demonstrated), `aspirational` (declared by the
  owner in their own words — locked from birth, visibly undemonstrated,
  redeemed to held when evidence arrives), `contested` (the owner's
  `not_true` verdict, or a judged conflict between two principles,
  marked as a pair). Contested stays visible; rank decides operationally
  until the owner resolves.
- **Human wording survives evidence loss.** A declared or human-edited
  principle is never automatically deleted when its support changes, even
  when it was originally minted. `unsupported_at` records loss of demonstrated
  support independently of a disagreement. Without a live dispute it reads
  `aspirational`; an existing `contested` stance stays contested. Both UI and
  machine rendering disclose withdrawn support while keeping the owner's
  instruction and wording. When qualifying evidence returns, the unsupported
  mark clears without resolving a dispute or rewriting the sentence.
- **Declarations are routed, never refused.** Validation runs
  internally at declaration: what qualifies becomes aspirational; what
  is really a rule or a goal is quietly kept as an inspiration — the
  layer where it already belongs. The surface shows where the words
  landed, never a test verdict.
- **Rank is the tie-breaker.** An explicit, owner-reorderable order;
  an owner reorder is sticky (generation thereafter appends, never
  re-sorts). This is what makes the set decidable for agents.
- **Many, not one.** The mirror of top of mind: top of mind is one
  bounded artifact rewritten whole and decaying by design; principles
  are an uncapped set selected by longevity, minted per-candidate with
  merge-on-overlap. Cardinality is the structural difference between
  the layers.
- **Generated from changed material**: three active, evidenced signals and
  at least one citing top-of-mind version can support an initial principle.
  Personal and agent top-of-mind jobs request generation; opening the view
  can queue missed work. Requests are deduplicated by material fingerprint.
  A nightly cron and hourly local recovery pass cover missed triggers.
  State maintenance is immediate SQL. No calendar wait is required.
- **The canonical rendering is machine-facing**: one deterministic
  markdown document (rank-ordered, stable ids, a self-describing
  preamble carrying the consumption contract), served byte-identically
  to every consumer — the primary consumers are AI tools deciding on
  the person's behalf. The web view is the human's decorated reading of
  the same document. For agents acting for the human, **aspirational is
  binding**: the person's declared word governs what their agents obey;
  demonstration governs only what WAKA asserts.
- **Audit chain**: decision → principle → signals → the person's own
  captures. Agents cite principle ids in decisions they leaned on.

## The edit rule (regeneration vs. humans)

Layers 2, 3, and 4 are machine-generated *and* human-modifiable. The
conflict rule, everywhere, is: **human edits lock the entry**. (Owner
declarations at layer 4 are locked from birth — they are the owner's
words on arrival.)

- The server never rewrites a human-touched signal or top-of-mind entry.
- Regeneration may: add new signals/entries, retire *untouched* stale
  ones, and continue attaching evidence/confidence to locked items — the
  human's text is frozen, its support keeps updating.
- Unlocking is an explicit human act (revert to generated, or delete).

## Sharing and privacy, summarized

1. Inspirations: private by default; `public` per capture by explicit
   choice, and then visible only in the rooms that account belongs to.
   Never world-readable. Evidence never crosses, whatever the capture's
   visibility says.
2. Signals: private by default; shared per group by explicit choice; the
   shared surface is the distilled statement, not the evidence.
3. A profile's top of mind: account-private, unless the owner enables the
   public profile surface.
4. Group top of mind: visible to members; entries may attribute
   contributing members' shared signals.
5. Group membership is between **human profiles** for now; agent profiles
   do not join walls (revisit if a use case appears).
6. Principles: account-private, **not shareable** in v1 — the group wall
   stays signals-only. Served outward only as the canonical machine
   rendering, under the profile's own credential, per the matrix.

---

## Vocabulary of record → current code

The current implementation predates this model and uses several of these
words for the wrong layer. Disposition of every existing concept:

| Canonical concept | Today in the code | Disposition |
|---|---|---|
| **Account** | `users` table | Stays the auth identity. |
| **Profile** | No entity — all data keyed `user_id` | New `profiles` table (`account_id`, `type: human \| agent`, name). Every memory table re-keys from `user_id` to `profile_id`. Public handle/visibility flags move from `users` to the human profile. |
| **Inspiration** (L1) | `signals` table (!), written by `POST /api/inspirations`; code aliases `signals`/`inspirations` for the same rows | Rename table + identifiers to `inspirations`; the alias dies. The route was right all along. Not append-only: editable/deletable with the evidence-cascade rule. |
| Capture provenance | `signals.source` (`app`/`agent`), `sessions.client` (`web`/`cli`) | `source` keeps its meaning (whose initiative). `sessions.client` is replaced by the session's **bound profile** (`sessions.profile_id`), which also subsumes the audit half of provenance. |
| Spark (removed) | `signal_sparks` (offsets, confidence, source variants incl. auto-detected, six unused analysis columns) | **Removed from the model entirely** — capture is text + attachments; salience extraction is wholly layer 2's job. Table and all spark code are deleted. Revisit only if telemetry shows extraction needs a human salience prior. |
| **Reflections** (L1 detail) | `reflections` | Kept — human-authored Q&A on an inspiration, re-keyed under profiles; input to extraction. The guided question *generator* is parked separately; the stored answers are not. |
| **Signal** (L2) | No first-class entity. Nearest machinery: `context_nodes`/`context_edges`/`context_evidence`, `signal_packets` | New first-class `signals` table: statement, confidence, lock state, share state, evidence links (M:N to inspirations). Embeddings become internal generation machinery; `signal_packets` are **deleted** (extraction reads inspirations + enrichment directly); the context-edge graph is parked. |
| Sharing flag | `signals.shared_to_groups` on the **capture** row | Moves to layer 2: per-signal, per-group. Raw captures are no longer shareable at all. |
| **Top of mind** (L3) | `top_of_mind_notes` (physical table renamed from `wow_moments`, code identifier still `wowMoments`), plus a separately computed `topOfMind` preview blob | One versioned `top_of_mind` artifact **per profile** with entries; notes table, preview blob, and the WOW→note compatibility serializer are all replaced. |
| WOW vocabulary | `wow_kind`, `why`, `belief_statement`, `reflection_question`, `reflection_guide`, `wow_score`; routes `/api/wow-moments`, `/api/wow-status` | Deleted. Native entry fields are designed for the new generator (`type`, `body`, `prompt`, `confidence` carry over from the current surface; belief statements get a deliberate yes/no as a native field, not a legacy leftover). |
| Lens boards | `top_of_mind_notes.lens` (`all`/`app`/`agent`) with separately generated per-lens boards | Deleted — superseded structurally: agent memory lives in the agent profile's own stack. `source` provenance remains on inspirations. |
| **Principle** (L4) | No entity | New `principles` + `principle_signals` tables (statement, type `value \| maxim \| stance`, state, rank, lock; M:N citations to signals); `feedback.target_type` gains `principle`. |
| **Wall** (personal) | The one-surface web UI | Concept unchanged: a profile's own surface over its layers — the principles view joins it as an always-present nav verb (the empty view teaches what a principle is and offers the declare line). |
| **Group wall** | Group rooms + feed of members' shared captures | Now shows members' **shared signals** (distilled statements), never raw captures. |
| **Group top of mind** | `group_top_of_mind_notes` (+ per-evidence `owner_user_id`), direction proposals/affirmations | Becomes the group-scoped `top_of_mind` artifact; the direction machinery is the co-editing mechanism producing new versions. |
| CLI auth | `auth-cli.ts` loopback flow, `cli_login_codes`, sessions with `client: "cli"` | Loopback flow gains a **consent + profile-selection step**; the minted session binds to the chosen profile. Per-profile scoping (read+capture vs full) is enforced from that binding. |

### API surface after the cleanup

| Route | Layer | Notes |
|---|---|---|
| `POST /api/inspirations`, `GET /api/inspirations` | L1 | Capture + private archive/recall (today's `GET /api/signals` archive behavior moves here), plus edit/delete. |
| `GET /api/inspirations/save-requests/:requestId` | L1 | Read-only reconciliation of an optional `Idempotency-Key` used on capture/answer creation. Returns only committed identity/processing metadata; missing is not proof of failure, removed is Gone. |
| `GET /api/inspirations/:id/processing`, `POST /:id/processing/retry` | L1–L3 | Personal material-to-reading progress and explicit failed-work recovery; same profile access boundary, no generation on GET. |
| `GET /api/signals` | L2 | **Repurposed**: lists the acting profile's distilled signals (statement, confidence, evidence count, lock/share state). |
| `GET /api/top-of-mind` | L3 | Returns the acting profile's single current artifact (+ version metadata). |
| `GET /api/principles`, `POST`, `PATCH /:id`, `DELETE /:id`, `POST /reorder` | L4 | Ranked set + owner curation. **No refresh endpoint** — generation belongs to the nightly cron alone. |
| `GET /api/principles.md` | L4 | The canonical machine rendering: one deterministic markdown document, byte-identical for every consumer. |
| `POST /api/harvest`, `GET /api/harvest`, `POST /:id/keep`, `POST /:id/decline` | before L1 | The harvest basket. Proposing is open to the human profile's own sessions, the keeper key included; reading and deciding are browser only. |
| `GET /api/inspirations/deleted`, `POST /deleted/:id/restore`, `DELETE /deleted/:id` | beside L1 | The deleted shelf: thirty days of each owned profile's deletes, including attachments. Human browser sessions only. |
| Cross-profile reads | L2/L3/L4 | An agent-bound session may read the human profile per the permission matrix (explicit target parameter; server-enforced). |
| `/api/wow-moments`, `/api/wow-status` | — | Deleted. |

### MCP tools after the cleanup

Tools act as the session's bound profile by default; cross-profile access
follows the permission matrix.

| Tool | Maps to | Notes |
|---|---|---|
| `waka_add_inspiration` (was `waka_add_signal`) | `POST /api/inspirations` | Same `source: "app" \| "agent"` contract; target profile defaults per binding (human-directed saves go to the human profile). |
| `waka_list_inspirations` (was `waka_list_signals`) | `GET /api/inspirations` | Episodic recall over raw captures. |
| `waka_list_signals` (new meaning) | `GET /api/signals` | Distilled patterns — likely the most useful recall surface for agents. |
| `waka_get_profile` | `GET /api/top-of-mind` | The bound profile's artifact; an agent session may also read the human profile's (read-only). |
| `waka_get_principles` | `GET /api/principles.md` | Returns the canonical markdown document — the same bytes the endpoint serves — plus the structured list for tools that want fields. |

---

## Naming rules going forward

1. One name per concept. No aliases, no `X (a.k.a. Y)` exports, no
   physical table named differently from its code identifier.
2. The API surface is the canonical vocabulary; storage follows it (via
   migration, not via serializer shims — the shim era ends with this
   cleanup).
3. MCP tool names track the canonical nouns, renamed in lockstep with the
   API in the same change.
4. A concept that needs a new word gets added to this document first.

## Decision log

- **2026-08-15** — Three-layer model adopted (inspiration → signal → top
  of mind); layers 2–3 are WAKA-generated, human-modifiable.
- **2026-08-15** — A signal is an **evidence-backed pattern** (M:N to
  inspirations), not a per-capture extraction.
- **2026-08-15** — **Human edits lock** entries against regeneration; the
  server adds and retires around locked items.
- **2026-08-15** — Sharing moves to layer 2: walls show distilled
  signals; raw inspirations never cross accounts.
- **2026-08-15** — **Profiles are first-class**: every profile (human or
  agent) owns a full stack; one top of mind per profile. Agent profiles
  are sub-profiles of the account (schema N, product one); the human is
  admin of all of them. Supersedes the lens-board decision from earlier
  the same day.
- **2026-08-15** — Inspirations are **editable and deletable** (not
  append-only); deletions cascade through evidence links, retiring
  unsupported unlocked signals.
- **2026-08-15** — Agent sessions get **read + capture** on the human
  profile, full access only to their own profile.
- **2026-08-15** — **Credentials bind to one profile**, chosen at the
  loopback login's consent step; audit and revocation are per-profile.
- **2026-08-15** — Defaults pending a counter-case: only humans and
  agents create inspirations (no system imports); groups are between
  human profiles; agent profiles don't join walls.
- **2026-08-15** — **Sparks removed from the model** (supersedes the
  keep-spark ruling from earlier the same day): capture is text +
  attachments only; no span annotation survives. Revisit only if
  telemetry shows extraction measurably needs a human salience prior.
- **2026-08-15** — Attachments are parsed into **enrichment**: links via
  a bounded deterministic fetch (title/description/bounded text), images
  via a one-time cached vision description. Enrichment is machine
  context at layer 1, consumed by extraction and embeddings — never
  presented as the human's words.
- **2026-08-15** — Reflections are kept as layer-1 detail (cleanly
  separable from the parked question generator); `signal_packets` are
  deleted — extraction reads inspirations and their enrichment directly.
- **2026-08-15** — Generation design adopted (see the goal doc, Phases
  4–5): signals via extract → embed → match-or-mint per inspiration;
  top of mind via one whole-artifact synthesis call per debounced
  refresh; the six-cluster classification call and the keyword-bucket
  node ontology are deleted, not ported.

- **2026-08-18** — **Principles adopted as layer 4**: context-free
  directives ("how the profile chooses"), distinct from rules
  (context-bound, checkable — and stored only as evidence). Five
  qualification tests: context, directive, evidence, time, completion.
- **2026-08-18** — Principles are **many, not one**: an uncapped growing
  set selected by longevity — the structural mirror of the single
  decaying top of mind. Minted per-candidate with merge-on-overlap and
  judged conflict marking (contested pairs, rank decides meanwhile).
- **2026-08-18** — Principle generation runs **once per day at midnight
  PST and nothing else may trigger it**; state maintenance stays
  immediate. Declarations are instant, owner-made, locked from birth.
- **2026-08-18** — Declarations are **routed, never refused**: internal
  validation sends qualifying ones to aspirational and rule/goal-shaped
  ones to the inspiration archive, with no displayed test verdict.
- **2026-08-18** — The **canonical rendering is machine-facing**: one
  deterministic markdown document served byte-identically everywhere;
  the web view is the human's reading of it. For agents acting on the
  person's behalf, aspirational principles are binding as the person's
  declared word.
- **2026-08-18** — Principles are per-profile like every layer, **not
  shareable** in v1, read-only to agent sessions on the human profile,
  and surfaced under progressive disclosure.
- **2026-08-21** — Progressive disclosure **reversed** (owner decision):
  the principles nav verb is always present, empty set or not — the
  empty view is the explanation. The board header ("X's top of mind" +
  last-read) now renders only on the wall view; every other view titles
  itself.
- **2026-08-21** — **The group wall returns to the web surface** as the
  rooms views (`/rooms`, `/rooms/:groupId`): doors, join-by-code, the
  wall of shared signals, the share picker, and the co-edited group top
  of mind with the full proposal flow. The rebuild had parked the old
  rooms UI and left the web group client unconsumed.
- **2026-08-21** — **Group top-of-mind synthesis implemented.** The
  rebuild shipped `refreshTopOfMindForGroup` as an explicit
  `not_implemented` seam — walls and proposals worked, but acceptance
  never materialized and no group reading was ever generated, which this
  document had described as existing. Now true: the wall is the
  selection, member decisions are applied by code (edit locks, removal
  dismisses, addition arrives locked), citations carry per-member
  attribution, and the groups e2e asserts that acceptance materializes
  a version. Mechanics: `docs/generation.md` §"The group's top of mind".

- **2026-08-22** — **Erasure is the model's one true delete, and its blast
  radius is now named.** Account erasure deletes every version of every
  group top of mind for any group the departing member was in or whose
  artifact cites their signals (`lib/account-erasure.ts`), then the room
  regenerates clean — one member's erasure destroys the whole room's
  co-authored version history. This is the sole exception to "fading
  never deletes," recorded here so the vocabulary of record stops being
  falsified by the code it governs. **Open ruling, gated on the founder
  and counsel** (`goals/a-room-you-can-trust.md`, Phase 0b): whether a
  majority-approved entry is the room's collective speech (versions
  survive, the departed rendered nameless and groundless) or the departed
  member's personal data (the current cascade is correct). Until ruled,
  no audit-of-record claim may be made for rooms.
- **2026-08-22** — **Open ruling, recorded before any non-human mind can
  touch a room: the decline asymmetry.** Accepting a group proposal
  needs a strict majority of current members; any single member can
  decline — kill — any open proposal alone
  (`routes/groups-proposals.ts`). Proposed resolution: refusal becomes a
  counted stance like affirmation — a proposal dies when a majority
  against is assured, or on timeout — so "a member is a member" holds
  for both verbs. Gated on the founder (`goals/a-room-you-can-trust.md`,
  Phase 0c); the code keeps today's rule until the ruling lands.
- **2026-08-29** — **The keeper key ships**: a standing credential for
  the PERSON, so their own MCP can keep and recall without the browser
  consent dance — the ask that completes the same day's separation
  ruling, which had retired the last way an agent could add to the
  human's stack. Deliberately LESS than the person: the session it
  resolves is `keyScoped` (read + capture on the person's own profile,
  nothing else), so a config file on disk never holds the account's
  admin. `keeper_keys` table, `waka_keeper_` prefix, `keeperKeyMayPass`
  allowlist at the `requireAuth` chokepoint, `keyScoped` branch in the
  matrix beneath it.
- **2026-08-29** — **RULED (founder): agent-generated memory is fully
  separate from the human's.** An agent session may READ the human
  profile (conditioning) and nothing more: the capture verb on the human
  is retired, and sibling grants open reading only — capture across any
  two profiles is now exclusively the human admin's act. Nothing an
  agent saves can enter, and therefore ever move, another profile's
  inspirations, signals, or top of mind. Supersedes the 2026-08-15
  read+capture default; enforcement is the one matrix in
  `resolveProfileAccess`, so every route inherits the flip. A
  consequence recorded honestly: the confidence source-diversity bonus
  can no longer newly arise on a human profile (agent-sourced evidence
  cannot arrive there); historical rows keep counting.
- **2026-08-23** — **RULED (founder): the sibling door flips to opt-in.**
  An agent-bound session reads and captures only the profile it is bound
  to and the human's; reading a sibling agent's memory requires an
  explicit, revocable, human-granted pairing listed beside credentials.
  The open intra-account default (`resolveProfileAccess` granting every
  agent read+capture on every profile) is retired with the grant
  machinery in `goals/no-quiet-corners.md` Phase 6 — no longer
  founder-gated; the flip ships with the phase.

- **2026-08-23** — **RULED (founder): WAKA is both.** The identity
  question is answered in the plural: a world for one person and their
  minds, AND infrastructure for teams — neither is a pivot away from the
  other. Sequencing is unchanged (the personal trust core ships first;
  the team door still stands behind its hard gates — the security audit
  before hosting strangers, eyes before hands before votes), but the
  team direction is identity now, not a hypothesis awaiting pilot
  evidence to justify its existence. Pilot evidence still decides
  *pace*, never *whether*.

- **2026-08-23** — **RULED (founder): the machine never picks between two
  things it believes about you.** The register's standing arbitration
  question is closed in the strictest direction: when derivation holds
  two opposed beliefs, both stand as **contested** and resolution comes
  only from an owner act (a lock or a verdict), after which the loser
  becomes **yielded** — a state, never a deletion. No evidence weight,
  however lopsided, resolves a pair on its own; the machine may name a
  tension, never settle one. This is "the world never moves unless the
  user moved it," applied to belief. Governs
  `goals/no-quiet-corners.md` Phase 5 (contested pairs), whose design
  assumed exactly this and is now doctrine rather than proposal.

- **2026-08-23** — **RULED (founder): a sentence the room approved belongs
  to the room.** The erasure question above is closed. Erasure stays the
  one true delete for everything the person OWNS — profiles, inspirations,
  signals, sessions, uploaded bytes — and now touches nothing the room
  settled: versions, entries, settled proposals, settled stances, and door
  marks all survive as **departed marks** (their `profiles` FKs are
  `set null`; the surface reads "someone" where a name was). The name is
  what erasure removes; the fact that someone was here is the room's.
  Live hands are withdrawn in the same transaction — the erased person's
  open proposals, and their stances on anyone's open proposals, go the way
  a removed member's do — and a `left` door mark is written per seat.
  "Fading never deletes" no longer has an exception for rooms.
  Implemented in `lib/account-erasure.ts`, migration
  `0016_the_departed_keep_their_marks`, pinned by
  `lib/account-erasure.db.test.ts` on real Postgres.

- **2026-08-23** — **RULED (founder): refusal is a counted stance, not a
  veto.** The decline asymmetry above is closed, in the direction
  proposed. A "not us" is recorded per member beside the yeses
  (`group_top_of_mind_affirmations.stance`: affirmed | declined; one row
  per member per proposal, answering again replaces the answer). A
  proposal carries on a strict majority of yeses against the current
  roll, exactly as before; it falls only when the nos make that majority
  arithmetically impossible (`fallsToDeclines`: declines × 2 ≥ members —
  in a room of two, one refusal still settles the question, now as
  arithmetic rather than as a veto). The author's own decline still
  resolves alone: withdrawing your own sentence is not a veto over
  anyone else. "A member is a member" now holds for both verbs.
  Implemented in `routes/groups-proposals.ts`, migration `0015_no_veto`,
  pinned by `routes/room-decline.db.test.ts` on real Postgres.

- **2026-08-22** — **The room's record survives its members** (Phase 0a
  of `goals/a-room-you-can-trust.md`): membership events are append-only
  history (`group_membership_events` — joined/left/removed; the seat row
  remains only the current seat), removal takes votes only from open
  proposals (who carried an accepted version is history), and a deleted
  signal leaves entry citations in place with a null reference rather
  than unwriting them from past versions. Evidence quotes are now stored
  only as verified spans, labeled whose words they are
  (`signal_evidence.quote_source`: own | enrichment); the lock gained
  its promised other half as **release** (the words stand; the generator
  regains jurisdiction; releasing unsupported words retires them).

The migration itself (schema, API, web, MCP phases and gates) belongs in a
`docs/goals/` goal document that references this file — for this layer,
`goals/principles.md`.
