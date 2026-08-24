# Where WAKA wedges: the 2026 agent-memory map, graded against our code

Status: research + strategy, authored 2026-08-22.
Evidence base: [`agent-memory-ecosystem-2026.md`](agent-memory-ecosystem-2026.md)
(external research, kept verbatim) plus a code-grounded review of both
repos: a ground audit of what actually ships, seven independent strategy
lenses (portability, teams, governance, arbitration, GTM, contrarian,
coherence), and adversarial feasibility and completeness passes over all
of them. Every claim below about our own code was verified by reading it;
file:line citations are current at this commit.

This document does what `second-brain-graveyard.md` did for capture
tools: takes the field's evidence, grades WAKA against it honestly, and
ends in house rules and a queue. It is a register and a plan, not a fix.

---

## The verdict in one paragraph

The 2026 evidence says the open frontier in agent memory is **governance
and behavior change** — who may read what, what gets written, what
survives correction, what is provably forgotten — while retrieval recall
is commoditized (LoCoMo/LongMemEval saturated and gameable) and
platform-native memory is in a documented trust collapse (OpenAI's own
summary "will not include everything ChatGPT remembers"; users who "have
to turn it off to trust any answer"; Claude Code removing user memories
from its system prompt after a poisoning disclosure). That frontier is
where WAKA already lives: the audit found our bets are **more shipped
than our own documents claim** — and that the doctrine carries four
specific debts where a sentence we say about ourselves is false in code.
So the wedge is not a pivot. It is **completion plus proof**: finish the
promises the canon already wrote down, record the read side of memory the
way we already record the write side, and turn every claim into a
machine-checked invariant the way `generation.md` already is. Proof over
recall.

---

## Part 1 — The audit: stronger than we say, and the debts

### Shipped stronger than documented

Seven assets the field would not guess a consumer memory app holds, each
verified in code:

1. **The lock is structural, not prompted.** `assembleEntries`
   (`packages/api/src/lib/top-of-mind-versioning.ts`) rebuilds every new
   top-of-mind version by copying human-touched entries out of the
   *previous version's database rows* — the model's output is only ever
   additive around them — and silently discards any model entry
   re-proposing a dismissed body, forever. At L2 the statement and
   `lockedAt` are written in one UPDATE (`routes/signals.ts:342`), so no
   unlocked window exists to race. "The lock is a rule in the
   version-writer, not a request to the model" is literally true. The
   research rates this bet highest-conviction (ETH Zurich: hand-written
   priors beat generated; the #1 platform complaint is an uncorrectable
   synthesis; A-MemGuard names locking as a defense) — and nothing it
   surveys enforces it structurally.
2. **Tenancy is a schema fact.** Composite `(profile_id, id)` foreign
   keys on every child table mean Postgres itself refuses a
   cross-principal memory link. Against GateMem's finding that Mem0's
   access-control violations run 28–67%, "our database cannot physically
   store a cross-tenant memory link — and a live permission-matrix suite
   walks the refused cross-profile write" is a one-sentence answer nobody
   else in the landscape can give.
3. **Dual provenance with server-side coercion.** Every capture records
   whose *initiative* it was (`source: app|agent`) separately from which
   session wrote it; a human session physically cannot claim `agent`, an
   agent capturing for its human cannot publish
   (`routes/inspirations-capture.ts:49-84`), and confidence pays a bonus
   only when both kinds of mind corroborate. That is a working, tuned
   instance of the consensus-validation discipline OWASP ASI06 and
   A-MemGuard call for.
4. **Rooms already have the governed write path the market lacks.**
   Strict majority (`affirmations * 2 > members`) counted against
   *current* membership, ejected members' votes vanishing, accepted text
   auto-locking (`routes/groups-proposals.ts:292`,
   `top-of-mind-synthesis.ts:990`). This is stricter than GOAL.md's own
   spec and is exactly what Tencent Team Memory (12.9K stars, "no
   governance for when memory is wrong") shipped without.
5. **`principles.md` is a proto-standard.** One deterministic,
   byte-identical, day-pinned markdown document with stable citable ids,
   honesty states (held/aspirational/contested, contested pairs naming
   each other), owner rank as the deterministic tie-breaker, and a
   consumption contract as its preamble. The research says no
   "AGENTS.md for learned memory" exists; we already ship the file such
   a standard would need.
6. **Drift-locked documentation is a trust instrument.**
   `generation-doc.test.ts` machine-checks the spec against shipped
   behavior in both directions on every commit — in a landscape where
   vendor benchmark numbers don't survive reproduction, "the spec cannot
   silently drift from the code" is a credibility asset no vendor holds.
7. **`verifyQuote` exists** (`lib/salience.ts:51`) — verbatim-span
   verification labeled own-words vs enrichment — written, documented,
   and orphaned with zero callers.

### The debts: sentences that are false in code today

Each of these is a doctrine claim one code-read away from embarrassment.
They are the real build list, and every one is strategy-proof — needed
identically by any future WAKA.

1. **~~No unlock path exists anywhere.~~ CLOSED 2026-08-24:** **release**
   shipped 2026-08-22 by Track S (`POST /api/signals/:id/release`,
   `/api/top-of-mind/entries/:id/release`) — the person's words stand,
   the generator regains jurisdiction, releasing unsupported words
   retires them. **revert** shipped with debt 2's chains
   (`POST /api/signals/:id/revert`, `/api/principles/:id/revert`): the
   machine's statement returns byte-for-byte from the chain, the lock
   clears, the restoration is itself a chain row. The verb pair is
   complete.
2. **~~L2 and L4 overwrite in place.~~ CLOSED 2026-08-24**
   (`goals/no-quiet-corners.md` Phase 2): `signal_statements` and
   `principle_statements` extend the L3 writer pattern — supersede
   chain, forward pointer, partial unique current-row index, reason
   enum (derived/restated/minted = the machine's hand,
   declared/edited = the owner's, reverted = the return). Written at
   mint, restatement, declaration and edit; the first post-migration
   edit of a pre-chain row seeds the machine's original before
   replacing it, so history reaches back one step further than the
   migration. Enforced by `statement-chain-contract.db.test.ts`.
3. **Nothing logs reads.** `sessions.lastSeenAt` is the entire read-side
   trace. No record exists of which session was served which
   `principles.md` rendering or top-of-mind version, and the p-id
   citations our skills instruct agents to make evaporate into their own
   transcripts. Write-side provenance is unusually rich; the read side is
   blank — and every field a serve log needs is already in the
   authenticated request context.
4. ~~**Erasure burns the room's history.**~~ **CLOSED 2026-08-23** by
   founder ruling: a sentence the room approved belongs to the room.
   `eraseAccount` no longer touches group artifacts — settled records
   survive as departed marks (`set null` FKs, "someone" on the surface),
   live hands are withdrawn, the person's own stack goes completely.
   "Fading never deletes" holds for rooms; see `data-model.md`'s
   decision log and `account-erasure.db.test.ts`.
5. **The sibling-agent channel is open by default.**
   `resolveProfileAccess` (`lib/middleware.ts:140-150`) grants an
   agent-bound session read+capture on *every* profile in the account —
   sibling agents included, up to eight — not just the human's. One
   poisoned agent can read every sibling's memory. Nobody consented to
   this; it is a latent default.
6. ~~**One member can veto what a majority must approve.**~~ **CLOSED
   2026-08-23** by founder ruling: refusal is a counted stance. A no is
   recorded beside the yeses; a proposal falls only when the nos make a
   yes-majority impossible (`fallsToDeclines`); only the author's own
   decline withdraws alone. The governance denial-of-service is gone;
   see `data-model.md`'s decision log and `room-decline.db.test.ts`.

Also stale in our own heads: the versions UI exists now (the poster
fetches its history, `Home.tsx:7061`); `MAX_AGENT_PROFILES = 8` is live
server-side; the shipped majority rule is stricter than GOAL.md's; and
reflections — hand-authored Q&A fed to extraction as "the strongest
context a capture carries" — are the exact hand-written-prior channel the
research's most-validated finding endorses, and we barely mention them.

---

## Part 2 — The thesis: complete the doctrine, then prove it

The research recommends "build lock + versioning + provenance first."
For WAKA that is not a build item — it is a **completion item and a
positioning item**. The frontier competency table (conflict resolution
7–60% industry-wide; multi-principal governance: no method passes;
forgetting under adversarial probes: no method passes; memory→action:
"inadequate") reads like a list of things our canon already promises and
our code mostly delivers. What remains is to make every promised sentence
true, record the half of the story we don't record, and then say only
sentences a test enforces.

The positioning that falls out is **proof over recall** — three claims,
each linked to the code that enforces it, instead of any benchmark
number:

- *"Human words survive regeneration"* — byte-for-byte, as a property of
  the data flow (`assembleEntries`).
- *"Our database cannot physically store a cross-principal memory
  link"* — composite FKs plus the live matrix suite.
- *"A model-invented citation cannot exist in our database"* —
  FK-validated citations.

And after the queue below: *"every read of your memory is attributable
to a named device acting as a named principal"* and *"no invented
quotes, ever."* We never enter the recall-benchmark fight the research
documents as vendor-conflicted and non-reproducing; our benchmark is our
own laws, machine-checked, published as a conformance suite the way
`generation.md` is already pinned.

---

## Part 3 — The queue

Ordered by (differentiation × evidence-alignment) / effort, adversarially
checked against the codebase and the goal queue. Effort in S/M/L for this
codebase. Items 1–3 converged independently from five or more of the
seven lenses — that convergence is itself the signal.

**1. Close the lock debt** (S/M). The unlock verb, human-session-only,
two modes: *revert* (restore the machine's statement, clear the lock,
re-embed) and *release* (keep the human's text, let regeneration retire
it normally — worded so it never reads as WAKA deleting a person's
writing). Under it, extend the L3 writer pattern (supersede + forward
pointer + partial unique index + reason enum) to signal statements and
principles, written on human edit and on first derivation, so the
machine's original survives. **Decision made here: a chain, not a single
remembered predecessor** — deterministic max-version arbitration, the
Misattribution answer, and any future contradiction benchmark all consume
the chain, and the writer pattern is proven. Completes the research's
#1-conviction bet; converts ChatGPT's top complaint into our sharpest
demo: correct it, and if you change your mind, get the machine's original
back byte-for-byte.

**2. The consultation record** (M). New noun: **consultation** — a record
that a session was served a profile's derived memory. One table
(session, profile, surface, artifact version or rendering day-stamp,
served-at) written by middleware on `GET /api/signals`,
`/api/top-of-mind`, `/api/principles.md`; MCP responses carry the version
receipt in the wire format. The write-back half: **a decision is a
capture, not a layer** — `kind=decision` inspirations recorded by the
acting session into its own profile, citing principle ids through a
citation table whose FKs make an invented citation physically unstorable
(the proven top-of-mind trick). Consultations are infrastructure beside
sessions, never a fifth layer, never input to generation; the world
renders them as states (a lit door: read today / this week / never),
numerals never. This is the capability OWASP ASI06 names, the
Misattribution Gap proves nobody has, and no competitor offers: the
first time an agent does something odd, "what was it told?" becomes a
query instead of an archaeology dig. Honest framing is load-bearing: a
receipt proves *consultation*, never obedience — sell it as the record,
not as behavior measurement.

**3. Wire `verifyQuote`** (S — an afternoon). Call it at the single site
where `signal_evidence.quote` is written; store a quote only as a
verified literal substring of the person's own text or the enrichment,
labeled which; move the 500-char clip after verification
(known-issues #H2 has the details). A missing quote stays honest-null; an
invented one becomes impossible. "No invented quotes, ever" — against
platforms whose synthesis shows no sources at all.

**4. Contested pairs at L2** (M). **Shipped 2026-08-24**
(`goals/no-quiet-corners.md` Phase 5): the judge contract is three-way
(`relation: same | independent | opposed`, schema-constrained, every
malformed answer landing on independent), an opposed verdict mints plus
an undirected `signal_contradictions` row, both sides serve `contested`
computed from the pair at serve time, owner acts resolve (lock, verdict,
dismissal — `partly` settles nothing, another member's verdict on a
shared statement settles nothing), the loser serves `yielded` with its
row intact, and the vocabulary is in `data-model.md`. Live three-way
spot-check on the real model: nine pairs, nine agreements — including
both held-tension probes refusing to read tension as opposition.
Original brief: the match-or-mint judge already fires
in the 0.7–0.86 band where negated statements disproportionately land —
extend its contract from the binary answer to
`same | independent | opposed` (the vocabulary L4 principle judging
already uses; this is real work on the judge contract, not an enum
one-liner) and mint an undirected `contradicts` relation alongside the
new signal. Zero new model calls. Vocabulary split, written into the
canon: a **tension** is held on purpose (an L3 entry type, a thing the
person carries); **contested** is an unresolved conflict awaiting
arbitration. Serving: unresolved pairs render as contested, both sides
standing; resolution comes only from an owner act (lock, verdict), after
which the loser becomes `yielded` — a state, never a deletion. Selection
may ride a contested pair into synthesis so the artifact names the
tension instead of asserting one side. This aims at the single
competency where the whole field breaks (FactConsolidation: Zep 7%,
Mem0 18%, best ~60%) with the deterministic-beats-LLM evidence on our
side and our own 2026-08-02 proof (awareness lives in arithmetic above
generation) as house doctrine.

**5. Sibling access becomes a grant** (S+). Flip
`resolveProfileAccess`'s intra-account default to human-profile-only for
agent sessions; sibling-agent access becomes an explicit, human-granted,
revocable pairing listed beside credentials. Add the refused-sibling-read
case to the live matrix suite. *Then* surface the eight-agent household
in the world — one column per mind is literally built for it — with the
grants visible, so the multi-agent account ships consented instead of
latent. Sequenced before any room-read surface so room content cannot
silently reach eight profiles.

**6. Everything-visible export** (S). **Shipped 2026-08-24**
(`goals/no-quiet-corners.md` Phase 3): `GET /api/export` — one
deterministic bundle: principles verbatim with citations and statement
chains, every signal with lock state, evidence, chain and shares, the
full top-of-mind version chain with reasons, raw inspirations with
attachments and reflections, the consultation, suppression, feedback
and decision-citation records. Human-session-only, own profile only —
the agent refusal and the zero-foreign-rows egress are pinned on real
Postgres through the real route (`export.db.test.ts`), and the export
writes its own consultation. Original brief:
Human-session-only, pinned by the live suite (an agent credential must
never exfiltrate the corpus). The anti-Dreaming: OpenAI warns its
summary "will not include everything ChatGPT remembers"; our export *is*
everything, and you can leave with it. `second-brain-graveyard.md`
already ruled an export door is a prerequisite of the
default-destination claim; the platforms' one-time import doors make it
distribution too.

**7. Dismissal descends to L2** (M). **Shipped 2026-08-24**
(`goals/the-legible-loop.md` Phase 3): `dismissed_at` on signals, the
`suppressions` table, `SIGNAL_SUPPRESSION_MIN_COSINE` drift-locked in
`generation.md`, refusal checked before the match, dismiss/restore verbs,
and the world's receipt — enforced by
`packages/api/src/lib/signal-suppression.db.test.ts`. The forgetting axis
scores now. Original brief: our one working negative memory —
L3 dismissals ride along every version and the generator cannot re-propose
them — generalized down: a dismissed signal keeps its row and evidence,
and its embedding becomes a suppression anchor; a candidate at ≥0.86
cosine to it is dropped instead of minted, with every suppression logged
so the silence is legible. **The word is dismissed, not tombstone** —
nothing is buried, something is remembered. This is the GateMem
forgetting axis (the one nobody passes, and today we score zero: deleting
does nothing to stop the same pattern re-minting), landed exactly where
the control-plane-placement result says it works. Room-level "never bring
this up again" arrives free once every-space-owns-its-stack gives rooms
their own L2. Adversarial-probe resistance (yes/no confirmation leakage)
is serving-side behavior — it goes to close-the-two-gaps as tests.

**8. Erasure redaction: departed, not deleted** (doc now; M gated).
Step 1, immediately and doc-only: a decision-log entry in
`data-model.md` naming erasure as the model's one true delete and its
exact blast radius — the canon stops being falsified by
`account-erasure.ts`. Step 2, gated on a founder doctrine call *and*
counsel: versions survive; the departed member's citations and
attribution flip to a new state **departed** (nameless, groundless — the
legible-silence pattern); their own statements go; locked
majority-approved text survives as the room's words *if* the
collective-speech-act theory survives legal review — if GDPR says
otherwise, the current cascade is correct and we document that instead.
Until this is decided, no audit-of-record or compliance sentence may be
uttered to anyone.

**9. Hosted WAKA + one-line install** (L, gated). Today `waka-login`
asks for *your deployed Lambda URL* — the research's "cheap MCP install"
beachhead is currently uninstallable by strangers, which makes every GTM
motion's denominator ~1. One multi-tenant stage (tenancy is already a
schema fact; the 60 job-starts/hr budget already caps free-tier cost),
signup on the existing consent page, waka-mcp on npm, three commands in
the README. **Hard gate: close-the-two-gaps Phase 1 runs first** —
hosting strangers converts every known auth gap in `known-issues.md`
from register entry to incident. Self-host stays a first-class documented
path; it is the privacy identity.

**10. The team door** (gated on the founder identity question, items 5
and 8, and the veto decision). When it opens: `waka_get_room` — a
read-only MCP tool serving the room's approved artifact through the
human's seat (a per-route carve-out of `humanProfilesOnly` on GETs only;
the tally is already member-type-blind), with room-read named as a scope
on the consent page. Eyes before hands before votes. Willingness-to-pay
gets tested with hand-invoiced pilots on today's governance, not with
billing code — and no pilot is honest until the veto asymmetry and the
erasure cascade are disclosed or fixed.

**Standing item:** resume `durable-interest` when the archive's data
matures (2026-08-30). The research's "≥3 is partly speculative; use
importance and recency" critique is that goal's exact program — promotion
beyond frequency is paid-for work, not a new idea. The one uncovered
sliver — a single owner gesture promoting a critical single-mention
signal (a lock or a `true` verdict promotes immediately; the
inflation-proof importance signal we already have) — rides along with its
resumption.

---

## Part 4 — Decisions

### Made here (the call, and the clause)

- **L2 history is a chain, not a single prior** — arbitration, audit,
  and the benchmark all consume the chain, and the writer is proven.
- **The machine never declares a winner between two things it believes
  about a person.** Owner-confirmed arbitrates (newest owner act wins);
  evidence recency may order presentation but never resolve — recency-
  wins is repetition-gameable, which makes it a poisoning vector, and
  authority over the person belongs to the person.
- **A decision is a capture** (`kind=decision`, citations FK-validated),
  and the consultation log is infrastructure beside sessions. No fifth
  layer, ever.
- **GateMem-shaped probes become tests inside close-the-two-gaps** —
  delegated requests, indirect inference, confirmation-after-deletion —
  and no scorecard is published. Our public trust artifact is the
  doctrine conformance suite: the five invariants above, drift-locked in
  CI, "true of the shipped code on every commit." Adopting an
  unreplicated synthetic benchmark as a north star would repeat the exact
  vendor pathology the research debunks.
- **The derived-memory format stays a working artifact.** A `SPEC.md`
  documents `principles.md`'s contract (v0, loudly), export-only; no
  AAIF campaign, no competitor adapters — a two-repo team cannot fight a
  standards war and build the world simultaneously. The tripwire below
  covers the case where the war starts without us.
- **Import waits.** Export-first; importing another model's synthesis is
  a poisoning vector (A-MemGuard's 66% detector miss rate) and needs a
  canon amendment for a third provenance class before it can exist.
  When it ships, the funnel pitch is real — "bring the synthesis you
  can't correct to the place where correcting it locks it" — but not
  before.
- **Rooms do not borrow the word "principles"** until
  every-space-owns-its-stack gives them a real fourth layer. The
  vocabulary blur is exactly what the naming rules exist to prevent.
- **The world is the product for the person; the canonical renderings
  and MCP are the doors for machines.** Two doors, one memory. The
  research's "thin destination app" framing inverts our reality — no
  vendor in its landscape has a surface a person wants to inhabit, and
  that surface is why the memory exists at all.

### The founder's three (genuine stops — reason 4: the question is the deliverable)

1. **Is WAKA a world for one person and their minds, or infrastructure
   for teams — and which identity constrains the other?** Nearly every
   cross-lens contradiction reduces to this. The evidence supports both;
   the code is ~70% individual and 0% team; a solo founder mid-freeze
   can only be one first. *Recommendation: individual-first — the
   deliberate-memory identity against platform surveillance-memory —
   with the team door earned by paid-pilot evidence, never by pivot.
   Items 1–8 are identity-proof either way.*
   **RULED 2026-08-23 (founder): both.** A world for one person and
   their minds AND infrastructure for teams — the team direction is
   identity, not hypothesis; sequencing and the hard gates stand; pilot
   evidence decides pace, never whether. Signed in `data-model.md`.
2. ~~**May the machine ever pick between two things it believes about
   you?**~~ **RULED 2026-08-23 (founder): never — the owner resolves.**
   Both sides stand as contested until an owner act; the loser becomes
   yielded, a state, never a deletion. Signed in `data-model.md`'s
   decision log; governs `goals/no-quiet-corners.md` Phase 5.
3. ~~**When one member's right to be forgotten collides with the room's
   right to its co-authored record, which wins — and is that law or
   doctrine?**~~ **RULED 2026-08-23 (founder): the room keeps its
   approved text** — erasure removes the person and their name;
   settled records survive as departed marks. Signed in
   `data-model.md`'s decision log, implemented and pinned
   (`account-erasure.db.test.ts`). Counsel review remains open before
   any compliance sentence is uttered to anyone.

---

## Part 5 — What we do not do

The merged kill list; every line traces to a founder law, a signed
decision, or the research's own evidence.

- No generic recall store, no `add_memory`/`search_memory`, no
  LoCoMo/LongMemEval chasing, no vendor-style benchmark comparisons —
  recall is the commoditized axis and the numbers don't reproduce.
- No rules registry, policy-YAML engine, or hosted CLAUDE.md/AGENTS.md —
  rules are evidence, never artifacts. Generated stanzas may *point* at
  live `principles.md`; they never copy it.
- No reproducible same-answer outputs from principles — considered and
  rejected; principles bound the option space, never pick answers.
- No agent write path into rooms, ever, and no `visibility` field on
  `waka_add_inspiration` — the server-side force-drop is the
  anti-prompt-injection-publishing doctrine. Room access arrives
  read-only or not at all; friction is solved by batched human consent,
  never by an agent-writable flag.
- No per-room visibility matrices or role taxonomies — one flag a person
  can hold in their head beats a matrix they cannot.
- No LLM anywhere in arbitration or as a poison detector — a model may
  *pair* contested signals; it may never pick the winner (66% miss rate
  is the evidence; 2026-08-02 is the house proof).
- No "tombstone" vocabulary — funerary words smuggle deletion semantics
  the canon rejects; the word is dismissed.
- No pricing per call, capture, or memory-operation (Mem0's documented
  pricing-cliff complaint; "a save is never a debt" forbids it
  independently). When pricing exists: capture and correction free
  forever; a second *account* reading you is what's paid.
- No numerals, scores, compliance percentages, or drift warnings on any
  surface — states render, numerals never; a room never measures a
  person. Metrics are founder instruments only.
- No hosted signup before the security audit; no share-personal-signal-
  into-room in any form (every-space-owns-its-stack is signed); no
  standards campaign; no reinventing what is paid for (durable-interest,
  wall-that-evolves Step 1, salience.md — resume, merge, wire).

---

## Part 6 — Open frontier, honestly

What this plan does not solve, so nobody mistakes the queue for the
frontier:

- **Measured behavior change.** Everything above records *consultation*
  — self-reported citation, attestation. The field's actual bar (did
  the agent's output follow the principle?) needs a verification loop
  nobody here or elsewhere has built. For coding agents it is concrete
  (did the diff follow the convention?) and is the natural next
  research act after the consultation record exists.
- **Write-path poisoning red-team.** Our defenses are structural, but no
  suite attacks extraction, the judge band, enrichment injection, or the
  budget ("a burst is the attack" is doctrine without an attack test).
  Belongs beside the GateMem probes in close-the-two-gaps.
- **The allocation question.** Nightly-only L4 minting is a clock, and
  "synthesis fires on evidence, never on a clock" is our own room
  doctrine — the tension is real and unresolved (the field calls it the
  open problem: when to consolidate, how much to spend, what to
  promote).
- **Cross-document precedence.** An agent can be bound by its human's
  principles, its own, a room's artifact, and a repo's AGENTS.md at
  once. "Higher rank wins" is intra-document only. This chapter must be
  written into the consumption contract before any team story ships.
- **The audit log's own compliance.** Immutable (OWASP) vs erasable
  (GDPR) needs a retention stance, an erasure-sweep answer, and a
  room-member-erasure answer, in the same decision-log entry that ships
  the consultation table.
- **The cost of our own gates.** Suppression neighborhoods, corroboration
  rules, symmetric declines all add refusal surface; GateMem's
  over-refusal axis (24–63% in the field) says instrument the utility
  cost of every gate we add — logged suppressions are the start.
- **Sycophancy.** Consultation receipts create an incentive to cite
  performatively (MemSyco-Bench exists because serving more memory can
  degrade judgment). A receipt is a record, never a compliance score —
  and nothing yet distinguishes a constrained agent from a parroting
  one.
- **Contradictions below the judge band.** Opposed pairs embedding under
  0.7 cosine are never compared; the contested-pair design inherits that
  recall floor. A nightly polarity sweep is the sketched, unbuilt fix.
- **Reflections are under-leveraged.** The one shipped feature matching
  the research's single most-validated finding (hand-written beats
  generated) appears nowhere in our story. It should be the
  human-authorship channel in the export format, the correction ritual,
  and the promotion escape hatch.

### Tripwires (check quarterly; each names its pre-committed response)

1. **A platform ships portable + user-lockable + audited memory** → the
   portability story thins; double down on multi-principal governance
   (rooms, grants, consultation) where platforms structurally cannot
   follow.
2. **A derived-memory standard emerges (AAIF or elsewhere)** → bring
   `principles.md` as the working reference implementation; join, don't
   fight. The SPEC.md exists so this move takes a week, not a quarter.
3. **A platform credibly solves governed multi-principal memory** →
   retreat to provenance/audit-of-record — which is only a position if
   items 2 and 8 shipped; that is half of why they rank where they do.

---

## Part 7 — Sequencing against the freeze

"Nothing merges until the world-on-main goal is done" (amended
2026-08-16) — and items 1–9 are all server-side. No lens priced this in;
it is the largest schedule risk in the whole plan. The honest options:
land items 1 and 3 (both S, both doctrine debts) as the first post-freeze
merges, or grant an explicit exemption for them as canon maintenance.
What is *not* frozen: documents. The two decision-log entries this plan
demands — naming the erasure exception, and posing the veto question —
cost paragraphs and should land now, so the vocabulary of record stops
being falsified by the code it governs.

The queue discipline stands as CLAUDE.md writes it: when a unit
finishes, pull the next item. The next item, as of this document, is the
unlock verb.

---

## Addendum, 2026-08-22 — founder: groups is a priority feature

The founder's call, same day: **groups is a priority feature.** This
answers the direction of founder question 1 — the room is load-bearing,
not an expansion — and it re-sequences Part 3. What it does *not* decide
by itself is which rooms: WAKA's own vision docs point at two-person
rooms of people whose hearts beat together (`finding-your-people`,
`combination-as-an-act`, the graveyard's "77% of group boards are
exactly two people"); the research points at coding-agent teams as the
monetizable population. The plan below serves both, because the trust
repairs and the loop are identical — the population choice only decides
who gets invited first.

Three consequences of the call:

1. **The room-trust repairs jump the queue.** A room is other people
   trusting WAKA with a co-authored record; every debt that can burn
   that record is now a launch blocker, not a backlog item.
2. **Hosting moves from item 9 to near the front of the line.** A room
   exists between accounts *on one deployment* — join-by-code cannot
   cross instances. Rooms as a real feature require strangers on a
   shared instance, which makes the close-the-two-gaps security audit
   urgent rather than queued.
3. **The personal trust core (unlock, verifyQuote, consultation) stays,
   as parallel small work** — a room's wall is made of members' locked
   and corrected statements, so rooms inherit every personal-layer
   trust property. Nothing there is displaced, only interleaved.

### The groups-first queue

**Phase 0 — make the room's record safe to trust** (before inviting
anyone new):

- ~~**Merge wall-that-evolves Step 1.**~~ **ABSORBED 2026-08-22 by
  `a-room-you-can-trust` Phase 0a:** versions survive refresh,
  proposals, and membership churn, pinned on real Postgres by
  `room-history.db.test.ts`.
- **Erasure redaction, both steps.** The decision-log entry naming the
  exception lands now; the departed-state redaction (versions survive,
  the departed member's traces go nameless) gets the founder doctrine
  call and counsel *now* rather than "when compliance asks" — because
  with groups as the priority, one member's account deletion burning
  the room's co-authored history is a product bug, not a legal
  footnote.
- **Decide the veto.** Symmetric decline — refusal joins affirmation as
  a counted stance; no single member, of any kind of mind, kills a
  proposal alone. One canon amendment, a few lines in
  `carriesMajority`'s neighborhood, and the asymmetry is gone before
  any new population can inherit it.
- Fold in the small known staleness: the group wall serves the stored
  confidence snapshot; label or live-compute it so the room never shows
  a number-shaped lie.

**Phase 1 — complete the room loop** (this is GOAL.md's own order,
promoted): react to another member's statement (`createFeedback`
currently targets only your own signals, so a room cannot accumulate
the affirmed material synthesis needs); synthesis fires on accumulated
evidence, never clock or button; the who-approved surface (named or by
hue, never a tally) with counter-proposals; the room's timeline
(versions are already stored — `room-timeline` Phase 2's failing gate
is the work).

**Phase 2 — rooms own their stack.** `every-space-owns-its-stack`
(signed 2026-08-17) stops being queued and becomes the center: a room's
sky distilled from its own public ground, retroactive retirement when a
capture goes private, and — landing naturally here — room-level
dismissal, the "never bring this up again" a governed room needs.

**Phase 3 — open the doors.**

- **Two before twenty.** The activation wedge is the two-person room —
  day-one path to starting one, per the graveyard's own data. A room of
  two is also the cheapest honest test of every governance rule.
- **Hosted WAKA**, still hard-gated on the security audit — but the
  audit itself is now scheduled work, because rooms-as-priority makes
  shared instances the product's substrate.
- **Agents get eyes** (`waka_get_room`, read-only, through the human's
  seat, named as a consent scope) — only after Phase 0 and the sibling
  grants, so room content never reaches eight profiles unconsented.
  Eyes before hands before votes stands.
- **Consultation extends to group serves** — which member's agent read
  which version of the room's artifact — completing the room's flight
  recorder, and with it the honest version of the team pitch if the
  founder points the room at coding teams.

The standing kill-lines all survive contact with this call, and two
matter more now: no share-personal-signal-into-room in any form (the
signed decision is the spine of Phase 2, not an obstacle to it), and no
agent write path into rooms — the room stays a place agents read and
humans decide, until the governance record says otherwise.
