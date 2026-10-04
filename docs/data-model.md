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
  the product starts by offering one.
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

### Credentials bind to a profile

Every session acts *as* exactly one profile:

- The browser session acts as the human profile (admin over the account).
- A CLI/MCP credential is minted **bound to one profile**, chosen during
  the loopback login's consent step. An agent using WAKA as its own memory
  logs in bound to its agent profile; audit and revocation are
  per-profile.

### What an agent session may do

A session bound to an agent profile gets:

| Target | Allowed |
|---|---|
| Its own agent profile | Full read/write: capture, curate signals, edit its top of mind, declare and curate its own principles |
| The account's human profile | **Read only**: top of mind, signals, and principles — the conditioning use case, an agent acting for the person reading how they choose. It writes NOTHING there, captures included: what an agent generates stays wholly in its own stack, so nothing an agent saves can move the human's inspirations, signals, or top of mind (founder ruling, 2026-08-29, decision log below — retires the read+capture default of 2026-08-15; relaying is the person keeping the memory themselves) |
| A sibling agent's profile | **Read only, and only through an explicit grant** (`agent_read_grants`, `POST /api/agent-grants`): human-granted, one-directional, revocable — revocation takes effect on the next request, and the revoked grant stays as record. Ungranted, the door is closed; and no grant opens capture — agents' generated memories never mix (same 2026-08-29 ruling). The open default retired 2026-08-24 with `goals/no-quiet-corners.md` Phase 6 (the flip is the founder's ruling of 2026-08-23, decision log below) |
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

A conversation may start from an owned, currently readable Principle via
`initial_principle_id`. This prioritizes the current wording in context without
inventing a user message. Its profile-bearing foreign key clears only the source
ID on deletion, preserving conversation history. Merely opening a conversation
does not request a reply.

Milestone 6 adds `conversation_reply_requests`, separate from user messages.
One pending/running reply is allowed per conversation. An initial request or
explicit retry compares the last request ID under the conversation lock: a
replayed retry joins its successor instead of dispatching twice. Each attempt
may dispatch to a provider at most once; ambiguous failures require a new,
explicit retry, which may incur a new provider charge. Limits are three attempts
per user message per hour and twenty provider dispatches per account per hour,
with at most 1,200 output tokens per dispatch. Dispatch timestamps survive
conversation deletion until profile erasure so deletion cannot reset the budget.

Stop is a publication fence, not a promise to undo provider billing. New messages,
memory changes, deletion and lost worker ownership prevent late publication.
Replies cite numbered current sources with verified quotes; persisted reference
metadata contains only source identity and a content/state hash. Historical
assistant words whose references changed are labeled and excluded from future
generation. They are conversation history, not new personal memory. Deleting
the conversation erases those words and reference metadata. Source access is
revalidated when opening a citation; no stale copied excerpt is served.

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
It is a deterministic retrieval foundation, not a semantic-answer quality claim.

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
Principle editing is a separate confirmation of exact wording and its observed
`statement_revision`. A stale edit conflicts; an exact retry of the immediately
applied revision is a no-op. Existing statement history and human locks apply.

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
Review session storage/routes now implement the selection contract below;
the opt-in conversation reply contract is specified above. Review skipping is
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

Suggested sessions contain at most five sources, prioritizing those without a
saved reflection or prior review choice, then newest first. Explicit selection
preserves the person's order. Selection and cursor writes queue no model work,
create no feedback and change no source/signal/principle. Cross-source answers
are a separate later R05 contract, not multiple per-item reflections.

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
  storage, boundedly checks status, and rechecks completion before the person
  opens an updated reading. Neither a timeout nor returning to the tab installs
  new wording. Removed/inaccessible sources withdraw the progress reference.
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
is a timestamp and takes effect on the key's next request.

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

**How the profile chooses, stripped of context.** A **rule** binds a
context ("≤$100 for LLM testing") and is checkable; a **principle**
survives having its context removed ("have something working before you
put more money in") and *compiles into* different rules per context.
WAKA stores the generator; captured rules are **evidence, never
artifacts**.

- **Five qualification tests**, all required for a minted principle:
  *context* (still instructs with every proper noun and number deleted),
  *directive* (prescribes the next choice; a fact about the person is a
  signal), *evidence* (cites ≥3 distinct signals from this profile's own
  history), *support* (dated evidence and representation in ≥1 top-of-mind
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
  Personal and room top-of-mind jobs request generation; opening the view
  can queue missed work. Requests are deduplicated by material fingerprint.
  A nightly cron and hourly local recovery pass cover missed triggers.
  Rooms own principles through their group profile, with membership-gated
  reads and citations restricted to currently visible room signals. Room
  curation is read-only; personal edits keep their existing locking behavior.
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
