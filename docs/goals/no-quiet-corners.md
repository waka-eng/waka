# Goal: no quiet corners

Status: in flight, yielding — first place in the queue handed to goals/the-legible-loop.md on 2026-08-23; this goal resumes at Phase 2 when it closes or halts. Go given 2026-08-23; created 2026-08-23 on the founder's instruction to fill
all remaining gaps. Phase 0 (the register stops lying) passed at
creation: this document's claims were verified against code the day it
was written, and the wedge register's two stale entries were corrected
in the same commit.
Strategy: `docs/craft/agent-memory-wedge.md` — this goal is the
remainder of its queue: every open item not owned by a signed goal.
Branch: `claude/waka-product-evolution-vbj1ur`.
Depends on: nothing. `every-space-owns-its-stack` (signed 2026-08-17)
is deliberately NOT this goal and nothing here pre-empts it; the same
for the hosted stage, the team door, and `durable-interest` (resumes
2026-08-30 by its own clock).

## Why

`a-room-you-can-trust` made the room's record undestroyable and honest.
What remains open, across the whole product, is one family of gap: the
places where WAKA acts **off the record** — serves memory and writes
nothing down, overwrites its own prior statement, refuses silently,
holds a conflict invisibly, grants access nobody consented to, or ships
a surface whose craft debt makes the record illegible. The 2026
evidence says the read side is where every platform is blank and where
the wedge is sharpest: write-side provenance is our strongest asset,
and the read side today is one timestamp. A product whose whole pitch
is "the record answers for itself" cannot have corners where nothing
was recorded.

Every phase below is strategy-proof (needed identically by any future
WAKA) and was verified open in code on 2026-08-23.

## What this goal will not do

- No new layers. A consultation is infrastructure beside sessions,
  never a fifth layer, never input to generation.
- No behavior claims. A receipt proves *consultation*, never obedience.
- Nothing here opens a door: hosting, `waka_get_room`, and two-person
  activation stay behind their own gates in the register.
- No numerals on any new surface; every new absence is a rendered
  state; nothing built here deletes anything.

## Phase 0 — the register stops lying (done at creation)

The wedge register's debt 1 claimed "no unlock path exists anywhere";
Track S shipped **release** on both layers (`POST
/api/signals/:id/release`, `/api/top-of-mind/entries/:id/release`). The
groups-first queue told us to "merge wall-that-evolves Step 1"; Phase
0a of `a-room-you-can-trust` absorbed that work (versions survive
refresh, proposals, membership churn — `room-history.db.test.ts`).
Both entries corrected. **Gate: every open claim in this document names
code that is true on the day it is read.** Drift found later reopens
this phase before any other work continues.

## Phase 1 — the consultation record

The flight recorder (register item 2, the last uncontested
#1-conviction item). One table — session, profile, surface, artifact
version or rendering day-stamp, served at — written by middleware on
`GET /api/signals`, `GET /api/top-of-mind`, and the principles
rendering; MCP responses carry the version receipt in the wire format.
The write-back half in the same phase: **a decision is a capture, not a
layer** — `kind=decision` inspirations recorded by the acting session
into its own profile, citing principle ids through a citation table
whose FKs make an invented citation physically unstorable.

**Gate:** a db test on real Postgres proves every serve of each surface
writes exactly one consultation naming the session, profile, and
version; an invented principle citation is unstorable at the schema; the
waka-mcp live suite re-run shows consultations for its own reads. The
world renders nothing yet — serving the record to the surface is the
"roots of a choice" row of the GLOSSARY, reserved, and stays reserved
until the record exists to serve.

## Phase 2 — the machine's original survives

Register item 1's unfinished half (debt 2). L2 and L4 overwrite in
place: a human edit destroys the machine's prior statement, so "what
did WAKA think before I corrected it" is unanswerable and
revert-to-generated is impossible even in principle. Extend the proven
L3 writer pattern — supersede chain, forward pointer, partial unique
index, reason enum — to signal statements (written on first derivation
and on human edit) and to principles. Then the lock verb pair
completes: **release** (shipped) keeps the person's words and returns
jurisdiction; **revert** (new) restores the machine's statement
byte-for-byte, clears the lock, re-embeds.

**Gate:** a contract test on real Postgres — derive, edit (locks),
revert: the machine's statement returns byte-identical from the chain;
the human's edit survives in the chain as history; no chain row is ever
deleted; release still behaves exactly as its Track S contract test
pins. `generation-doc.test.ts` still green both directions.

## Phase 3 — everything visible

Register item 6. `GET /api/export`: one deterministic bundle of the
whole human profile — principles verbatim, every signal with lock state,
evidence, and (after Phase 2) its statement chain, the full top-of-mind
version chain with reasons, raw inspirations, and (after Phase 1) the
consultation record. Human-session-only. The anti-Dreaming: the export
*is* everything, and you can leave with it.

**Gate:** a db test exports a seeded fixture account and the bundle
contains every row of every layer for that profile and zero rows of any
other (the tenancy read applied to egress); an agent-bound credential
is refused, pinned in the live matrix suite.

## Phase 4 — refusal reaches the ground (moved)

**Moved 2026-08-23 to `goals/the-legible-loop.md` Phase 3** when the
founder promoted the loop-legibility work to its own goal: the
suppression log is the substrate the gesture receipts stand on, so it
travels with them. The register item (7, the forgetting axis) keeps
one owner — there.

## Phase 5 — contested pairs

Register item 4, the judge-contract work. Extend match-or-mint from
binary `samePattern` to `same | independent | opposed` (the vocabulary
principle judging already uses) and mint an undirected `contradicts`
relation alongside the new signal. Canon vocabulary written into
`data-model.md`: a **tension** is held on purpose; **contested** is an
unresolved conflict awaiting arbitration; resolution comes only from an
owner act (lock, verdict), after which the loser becomes **yielded** —
a state, never a deletion. **Owner-only resolution is doctrine, not
design** — ruled by the founder 2026-08-23 ("never — the owner
resolves"), signed in `data-model.md`'s decision log: no evidence
weight, however lopsided, resolves a pair on its own. Selection may ride a contested pair into
synthesis so the artifact names the tension instead of asserting one
side.

**Gate:** judge-contract tests cover all three verdicts with fenced,
schema-constrained prompts; a db test proves an opposed verdict mints
the new signal plus the `contradicts` row and both sides serve as
contested; an owner act resolves and the loser reads `yielded` with its
row intact. One live spot-check of the three-way judge on the real
model (≤ 20 calls), numbers in the log.

## Phase 6 — the sibling door gets a hand on it

Register item 5, sequenced before any room-read surface ever ships.
`resolveProfileAccess` grants an agent-bound session read+capture on
*every* profile in the account — sibling agents included. Build the
grant: an explicit, human-granted, revocable pairing listed beside
credentials, with the refused-sibling-read case added to the live
matrix suite. **The flip is RULED (founder, 2026-08-23): opt-in ships
with this phase** — no flag, no dark machinery; the open default
retires when the grants land. Signed in `data-model.md`'s decision
log.

**Gate:** db + live-matrix tests prove a granted sibling reads, an
ungranted one is refused, revocation takes effect on the next request,
and the human's own profile and the agent's bound profile need no
grant. The waka-mcp live suite re-run stays green through the flip.

## Phase 7 — the queue is fair

Found live on 2026-08-23: 205 filler derivations starved two enrichment
jobs for the account's whole model-budget window — FIFO plus a
per-account budget means bulk capture makes enrichment invisible for an
hour, indistinguishable from breakage. Give the claim loop kind
fairness (interleave job kinds per account, or reserve a slice of the
budget for enrichment) without touching the budget's totals.

**Gate:** a db test seeds 100 pending derivations and one enrichment
job for one account and proves the enrichment is claimed within the
first drain pass; `model-budget.test.ts` unchanged and green — the
budget itself is not this phase's to move.

## Phase 8 — the world pays its craft debts

The brief's design-pass items plus one found in the walkthrough, each a
place the record is true but illegible: the star-turn animation
(0.4–0.8 s, motion explaining the state change, never decorating); the
drawn sky→field root lines; dial-scrubbing the room's history (the
timeline is served and told — the dial does not yet wind it); WCAG AA
contrast measured on dim/highlight ink (numbers, not impressions); and
the star rendering on your own locked statement where it hangs over a
room's wall (today the lock is invisible exactly where other people
read the sentence).

**Gate:** web tests pin each behavior; measured contrast ratios
recorded in the log with the failing pairs fixed to ≥ 4.5:1 (or the
exception argued in writing); **the motion is founder-gated** — the
founder's eyes accept the star turn and root lines, because motion is a
founder law and taste is not delegable.

## Phase 9 — the loop shows its hands (moved)

**Moved 2026-08-23 to `goals/the-legible-loop.md`** — the founder
promoted it to its own goal ("create /goal to build this all") after
the research in `docs/craft/the-legible-loop.md`. That goal runs
first; this one resumes at Phase 2 when it closes or halts.

## Track D — the demo kit

The 30-second demo stopped being a gate on 2026-08-23 —
`a-room-you-can-trust` closed on substituted evidence after the founder
questioned the recording's necessity — but the demo world is still the
first thing WAKA shows anyone, and today it exists only as a hand-run
scratchpad script. Commit `tools/demo/`: one command against a fresh local stack
that seeds the recordable world — the archive, the minted signals, the
star, the room, the counted stances, the door marks — plus the
six-scene shot list in its README, in the product's English.

**Gate:** on a clean database, one command produces a world in which
every scene of the shot list is on screen within one minute of login,
verified by the same headless walk that produced the 2026-08-23
screenshots.

## Standing founder gates (listed, never worked around)

- The Phase 8 motion sign-off — **the founder reviews live on their own
  machine** (ruled 2026-08-23): when Phase 8 lands, the log carries the
  exact run commands and the phase holds at its gate until they have
  looked.
- Counsel review of the erasure doctrine before any compliance sentence
  is uttered to anyone.
- Closed 2026-08-23, all by founder answer: the Phase 6 flip (ruled —
  opt-in ships with the phase); the identity question (ruled — WAKA is
  both, a world for one person and their minds AND infrastructure for
  teams; sequencing and hard gates unchanged); arbitration (never — the
  owner resolves); the 30-second recording (`a-room-you-can-trust`
  accepted on substituted evidence).

## Budget

Model spend: Phase 5's live spot-check (≤ 20 calls) and Track D's seed
runs (≈ 10 derivations per run). Everything else runs on stubs and real
Postgres. No new infrastructure, no new dependencies.

## Acceptance

- Every serve of derived memory is a queryable record; every refusal to
  mint is a logged suppression; every held conflict renders as
  contested; every machine statement survives its own correction.
- A person can leave with everything, and only a person can.
- No agent reads a sibling without a visible grant once the founder
  flips the default — and until then, the machinery is proven dark.
- The world shows the lock wherever the sentence is read, moves only to
  explain, and meets the contrast it claims.
- The demo world is one command, so the last gate of the previous goal
  costs the founder thirty seconds, not an evening.

## Log

- **2026-08-24 — Phase 5: PASS.** Contested pairs are held, and only the
  owner settles them. The merge judge's contract is three-way —
  `relation: same | independent | opposed`, schema-constrained with the
  enum in the response schema, fenced statements, temperature zero — and
  every failure direction lands on `independent`: a wrong same fuses
  invisibly, a wrong opposed manufactures a dispute the person never had
  (`gemini-judge.test.ts` re-pinned; the `samePattern` wire key is
  retired everywhere in one commit, exactly as the vocabulary gate's own
  allowlist entry predicted it would have to be — that entry is deleted
  and its meta-test re-anchored). In the band, `opposed` mints AND
  records the undirected `signal_contradictions` pair (normalized a<b,
  one row per pair, migration `0022`); both sides serve `contested`,
  computed from the pair rows at serve time like every other standing.
  Resolution (`lib/contested-pairs.ts`) comes only from an owner act —
  lock and an owner's `true` settle for the acted side, an owner's
  `not_true` against it, dismissal against the thrown-out side; `partly`
  settles nothing, and another member's verdict on a shared statement
  settles nothing (standing to answer is not standing to arbitrate).
  The loser serves `yielded` off the resolved pair — a state, never a
  deletion, its row and evidence untouched; a resolved pair is not
  reopened by re-derivation (the machine re-litigating would be the
  machine arbitrating). Vocabulary written into `data-model.md`'s signal
  section (tension / contested / yielded); the export bundle carries the
  pair record. Gate measured: `contested-pairs.db.test.ts` 6/6 on real
  Postgres through the real `applyCandidates`, lock, feedback and
  dismiss paths; judge-contract suite re-pinned (three verdicts,
  tension-is-not-opposition and uncertainty-means-independent asserted
  against the prompt itself); LIVE three-way spot-check on
  `gemini-3.1-flash-lite`: nine pairs, nine agreements, nine calls —
  three opposed, two same, two independent, and both held-tension probes
  ("loves rich food / keeps weekday meals plain", "ship fast / refuse
  untested") correctly independent, never opposed. api 57 files / 632
  tests, web 146, vocabulary and seams clean. Deliberately excluded: any
  synthesis-prompt change — selection already carries contested signals,
  and the artifact-side naming of tensions rides the existing entry
  types. Register item 4 (agent-memory-wedge) closed.

- **2026-08-24 — Phase 3: PASS.** Everything visible. `GET /api/export`
  serves the whole human profile as one deterministic bundle
  (`lib/profile-export.ts`): principles verbatim with citations and
  statement chains, every signal with lock state, evidence, chain and
  shares, the full top-of-mind version chain with reasons and entry
  citations, raw inspirations with attachments and reflections, and the
  four records — consultations, suppressions, feedback, decision
  citations. Rows are served whole (no cherry-picked columns to go stale)
  and every list is ordered (created_at, id), so the same stack serves
  the same bytes twice. Human-session-only and own-profile-only by
  construction — no `?profile=` exists on the route, and an agent-bound
  credential gets a 403 before any query runs; egress is stricter than
  any serve. The export itself is a consultation (new surface value
  `export`, migration `0021`): the largest serve goes on the record like
  the smallest. Deliberately excluded, stated in the assembler's header:
  embedding vectors and background jobs (recomputable infrastructure),
  session rows (credentials are not memory), and other members' room
  content (the person's own shares are in; the room's wall is the
  room's). Gate measured: `export.db.test.ts` 4/4 on real Postgres
  through the real route — a fixture account seeded across every
  exported table gets every row back per-table-exactly while a second
  profile's rows appear zero times; the determinism case compares bytes
  across two serves; the agent refusal is pinned live (and writes no
  serve record); the export's own consultation is asserted. api 56
  files / 626 tests, web 146, vocabulary and seams clean. Register item
  6 (agent-memory-wedge) closed.

- **2026-08-24 — Phase 2: PASS.** The machine's original survives.
  Migration `0020_the-machines-original-survives`: `signal_statements`
  and `principle_statements`, the L3 writer pattern extended down and
  up — supersede chain, forward pointer filled the moment the successor
  exists, partial unique index holding exactly one current row per
  parent, and a `statement_reason` enum that says whose hand wrote each
  row (derived/restated/minted the machine's; declared/edited the
  owner's; reverted the machine's sentence returned by the owner's own
  act). One writer (`lib/statement-chains.ts`) serves both layers and
  never deletes; chains begin at birth (mint writes `derived`/`minted`,
  a declaration writes `declared` — the owner's words from the first
  row, so revert correctly finds nothing machine-side there), the
  machine's restatement of an emerging signal writes `restated`, and
  the first post-migration edit of a PRE-chain row seeds the pre-edit
  sentence as the machine's before replacing it — the original becomes
  recoverable for old rows too, from the very edit that would have
  destroyed it. The verb pair completes: `POST /api/signals/:id/revert`
  and `POST /api/principles/:id/revert` restore the newest machine-side
  statement byte-for-byte, clear the lock, chain the restoration, and
  (signals) drop the stale vector and enqueue the re-embed exactly as
  the edit path does; a chain holding only the owner's words answers
  409 rather than inventing an original. Gate measured:
  `statement-chain-contract.db.test.ts` 5/5 on real Postgres through
  the real writers (derive → edit → revert byte-identical with the edit
  surviving as history; revert returns the newest machine statement —
  a restatement, not the first draft; pre-chain seeding; declared
  principles refuse; a minted principle edited and reverted at layer
  four), release's own Track S contract suite untouched and green,
  `generation-doc.test.ts` green both directions, api 55 files / 622
  tests, web 146, vocabulary and seams clean. Deliberately excluded: a
  world door for revert — the API verb is live for every kind of mind,
  and the world's own gesture rides with Phase 8's craft pass.

- **2026-08-23 — Phase 1: PASS.** The read side answers for itself.
  `consultations` table (migration `0017_the_read_side_gets_a_record`)
  written awaited — a serve that cannot be recorded fails loudly rather
  than happening off the record — by `GET /api/signals`,
  `GET /api/top-of-mind` (artifact version as the receipt; the honest
  null when nothing is synthesized), the principles JSON list (the
  serve the MCP client actually reads), and the principles.md rendering
  (day-stamp as the receipt, already in the wire format's trailing
  line). The write-back half: `kind=decision` joined the inspiration
  kinds, and `decision_principle_citations` cites through DOUBLE
  composite (profile_id, id) FKs — an invented citation, or another
  profile's principle, is refused by Postgres and the whole capture
  rolls back. Gate measured: `consultations.db.test.ts` 6/6 on real
  Postgres through the real route handlers (one row per serve naming
  session + reader + version; accumulation not overwrite; atomic
  citation; invented/foreign/wrong-kind citations all refused); full
  api suite 50 files / 599 tests; vocabulary clean; live waka-mcp
  suite 9/9 with a **peak of 10 consultations on the record during the
  run** — and zero after, because the suite erases its account and the
  record cascades with the served profile, which is the erasure
  doctrine doing its job, not a leak. Also this phase: the founder's
  loop question arrived mid-build and became Phase 9 — the consultation
  record and Phase 4's suppression log are two of its three
  prerequisites, so the sequencing holds.

- **2026-08-23 — Three founder answers land before the first phase
  runs.** (1) **Arbitration ruled**: never — the owner resolves; Phase
  5's owner-only design is doctrine now, signed in `data-model.md`.
  (2) **The demo gate closed**: the founder questioned the recording's
  necessity and `a-room-you-can-trust` accepted on substituted
  evidence; Track D reframed from gate-serving to demo material.
  (3) **The sibling door**: asked to choose a default, the founder
  asked for the strategy-aligned recommendation instead. It is
  **flip to opt-in**, for three register-grounded reasons: the queue's
  own sequencing makes the flip a precondition of any room-read surface
  (room content must never reach eight profiles unconsented); the
  product's identity is deliberate, consent-visible memory, and a
  latent open channel is the one fact in the codebase that contradicts
  it; and the flip is cheapest now, before any population inherits the
  open default as an expectation. The default flip remains the
  founder's word; Phase 6 builds everything up to it either way. Also
  answered: the branch keeps accumulating — no pull request yet.

- **2026-08-23 — Created, Phase 0 passed at birth.** Every claim above
  verified against code today; wedge register corrected in the same
  commit (debt 1 rewritten — release shipped in Track S, revert +
  chains still open, now Phase 2 here; the "merge wall-that-evolves"
  queue item marked absorbed by `a-room-you-can-trust` Phase 0a).
  Open-item inventory at creation: register items 1 (half), 2, 4, 5,
  6, 7 open; 3, 8 closed; 9, 10 gated elsewhere; plus the brief's
  design-pass debts, the walkthrough's starved-queue finding, and the
  demo kit.
