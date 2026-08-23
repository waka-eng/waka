# Goal: no quiet corners

Status: in flight — go given 2026-08-23; created 2026-08-23 on the founder's instruction to fill
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

## Phase 4 — refusal reaches the ground

Register item 7: dismissal descends to L2. Today deleting or dismissing
does nothing to stop the same pattern re-minting — the forgetting axis
nobody passes, and we score zero. A dismissed signal keeps its row and
evidence, and its embedding becomes a suppression anchor: a candidate
at ≥ 0.86 cosine to it is dropped instead of minted, **with every
suppression logged so the silence is legible**. The word is dismissed,
not tombstone — nothing is buried, something is remembered. Zero new
model calls.

**Gate:** a db test with stub embeddings — a candidate near a dismissed
signal's anchor is dropped and writes a suppression record naming the
anchor; a distant candidate mints normally; dismissing never deletes
the signal's row or evidence. The tuning constant joins
`docs/generation.md`'s drift-locked table.

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
