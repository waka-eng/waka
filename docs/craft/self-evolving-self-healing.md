# Governed self-evolution: what the field does, what WAKA already does, what to add

Status: research + design directions, authored 2026-08-30.
Question answered: can self-evolving and self-healing be incorporated into
WAKA — and does memory infrastructure do either today? Method: one deep
research pass (2026-08-30) on exactly these two axes over products and
literature, synthesized against the canon (`data-model.md`,
`generation.md`) and the standing kill list
(`agent-memory-wedge.md` Part 5). Source URLs and verification flags are
from the pass; paper claims are papers, product claims are products,
vendor-only claims are marked.

---

## The verdict in one paragraph

Self-evolving memory is the field's main direction — and its main wound:
every system that lets memory rewrite itself either ships weak guards
(ChatGPT's Dreaming rewrites automatically with steering, not approval) or
documents the failure (one wrong fact propagating into linked notes,
agents reusing their own mistakes "with even more confidence").
Self-healing barely exists: one shipped middleware, a shelf of papers, and
a closed detect-and-repair loop shipped by nobody. WAKA is already a
self-evolving system — restatement, re-derivation, re-synthesis, nightly
minting, read-time decay — with the one guard the gating literature says
is mandatory and the products lack: **the mutable layer is fenced by
immutable owner anchors (locks, chains, triggers) enforced outside the
model's reach.** So the answer is not "add self-evolution" but "extend it
under the governance line, and turn the field's gaps into stances": evolve
only the unlocked machine layer, always chained; heal by detecting
autonomously and repairing only through owner verbs; and start saying out
loud that locks are the "constitutional memory entries evolution provably
cannot rewrite" — a mechanism the research pass lists, verbatim, as
existing nowhere else.

---

## Part 1 — What the field actually does

### Self-evolving: the main direction, guardrails optional

- **A-Mem** (arXiv 2502.12110): each new memory triggers an LLM pass that
  may rewrite *old* notes' context/keywords/tags in light of it. The
  follow-up critique line (H-Mem, MemHarness) names the cost: one wrong
  fact becomes durable and networked as it propagates into neighbors.
- **Letta**: sleep-time agents (arXiv 2504.13171) rewrite the primary
  agent's memory blocks during idle time — and **Context Repositories**
  make every memory change a git commit (diff, rollback, branch/merge):
  the strongest shipped versioning guard in the field.
- **ChatGPT Dreaming** (June 2026): background re-synthesis rewrites
  remembered facts as they age; guards are transparency and topic
  steering, never approval. OpenAI's own recall evals went 41.5% → 82.8% —
  autonomous rewriting *works*, which is exactly why it will spread.
- **Anthropic managed-agents Dreaming** (May 2026): fleet-level pattern
  extraction with the guard the consumer version lacks — operator-set
  autonomy, including **review-the-diff-before-it-lands**. Harvey reports
  ~6× task completion (vendor-relayed).
- **Literature**: the canonical taxonomy (arXiv 2507.21046) puts memory
  evolution under "context evolution"; Voyager's skill library is
  append-only (skills composed, never rewritten); Memp (arXiv 2508.06433)
  updates *and deprecates* procedural memories; EvoMemBench's headline is
  humbling — "no memory form wins consistently."
- **The failure modes are documented, not hypothetical**: OEP experience
  poisoning (arXiv 2605.18930) hits >50% attack success with no malicious
  text — it seeds clean-looking experiences that distill into
  locally-correct, non-transferable rules; SkillJack (arXiv 2608.03509)
  implants persistent backdoored skills through the learning pipeline
  itself; Databricks documents agents turning "one mistake into a
  recurring one by storing it and retrieving it later as evidence."

### Self-healing: papers, one middleware, no closed loop

- **Detection**: A-MemGuard (arXiv 2510.02373) — consensus validation
  across parallel reasoning paths plus a "lessons" store — cuts attack
  success >95% *on paper*; shipped in no product. **OWASP Agent Memory
  Guard** is the one shipped thing: middleware screening every memory
  read/write (detectors incl. a SelfReinforcementDetector for bursts of
  self-similar agent-authored writes), SHA-256 baselines on protected
  keys, and point-in-time snapshots — with rollback *operator-triggered*,
  not autonomous. Letta has an open issue asking for its integration;
  none of the major memory products embed any of it.
- **Repair**: Zep sets `invalid_at` on contradicted edges (invalidate,
  never delete) — with a documented failure where a weak judge model
  collapses contradiction detection and stale facts survive; Supermemory
  reconciles in background (mechanism unpublished); Mem0's "decay" is
  search-time re-ranking, never deletion. Dependency-guided rollback
  repair and deletion-propagation-through-derivation-chains exist as
  papers (arXiv 2608.10502, 2602.17692).
- **The gating literature reads like our canon written independently**:
  SSGM (arXiv 2603.11768) — mutable active graph over an append-only
  immutable log; "Agentic Safety is an Epistemic Property" (arXiv
  2606.28347) — an approval gate is meaningless if it lives inside the
  self-editable substrate, enforcement must be external and immutable;
  memorywire (arXiv 2606.01138) — diff-and-approve for memory writes;
  plus human-in-the-loop freezing surveys. No controlled study measures
  autonomous-rewrite vs frozen-memory quality over months.

### The pass's "exists nowhere" list

1. Closed-loop self-healing (detect → autonomous repair/rollback).
2. Scheduled re-verification of remembered facts against their sources.
3. Cryptographic/signed integrity inside managed memory platforms.
4. **User-lockable "constitutional" entries that evolution provably
   cannot rewrite, in any consumer platform.**
5. Longitudinal eval of rewrite drift (store quality after N rewrites).
6. Consensus validation in any shipped product.

Item 4 is WAKA, shipped. Item 5 is a benchmark our version chains are
uniquely positioned to define.

---

## Part 2 — WAKA is already both, in bounded form

Worth stating plainly, because the canon never uses these words:

**Already self-evolving** — restatement (a confirming capture may reword
an emerging, unedited signal — and wording *settles* at active or on
human edit: evolution with a settlement rule); re-derivation on edit and
on enrichment arrival; whole-artifact re-synthesis; nightly principle
minting with merge-on-overlap; confidence and selection evolving at every
read with no write at all. And every machine rewrite is **chained**
(supersede + forward pointer + reason enum) — the field's nearest analog
is Letta's git-backed memory, and our chains carry *why* (derived /
restated / minted vs declared / edited vs reverted), which a git log
doesn't.

**Already self-healing** — evidence-cascade reconciliation inside the
delete transaction (the dangling-reference problem the rollback-repair
papers solve, prevented by FKs instead of repaired after); retirement at
zero evidence; `unsupported_at` on locked signals (the owner's words
stand, excluded from synthesis); suppression anchors stopping refused
patterns from re-forming — the exact "information backflow" resurfacing
failure GateMem shows every tested method committing; `rerun_requested`
trailing-edge semantics so an edit racing a derivation is never lost;
no-change versions so a silent pass and a broken generator can't look
alike; the promotion trigger refusing a hand-forged active signal below
the bar — integrity enforcement living *outside* the editable substrate,
which is precisely the epistemic-safety paper's demand.

The structural anti-poisoning position is stronger than anything the
attack literature assumes: OEP and SkillJack poison the write path of a
self-evolving store — and nothing an agent writes can reach the human's
store at all (2026-08-29). The human stack's write path is the person.

---

## Part 3 — What to incorporate, and what to refuse

The doctrine line that bounds all of it: the machine may evolve **its own
unlocked layer**, always chained, always receipted; it may detect
anything, propose anything, and *apply* nothing above the line — locks,
verdicts, dismissals, rank, and reverts are owner verbs. "The world never
moves unless the user moved it," applied to self-modification.

### Add (in rough order of leverage)

1. **The proposed-diff reread — Anthropic's guard, our proposal
   machinery.** A periodic (or owner-invoked) pass may propose edits to
   *unlocked* machine statements — stale wording, mergeable
   near-duplicates, faded emphasis — surfaced as a diff the owner
   accepts or declines; accepted text follows the normal chain, declined
   proposals are receipts. Rooms already implement exactly this shape
   (propose → affirm → accepted → lock); memorywire is the paper version.
   This is the sanctioned form of Dreaming: same benefit, but the
   rewrite lands only through the owner's hand.
2. **Principle staleness as a proposed state, never an act.** Principle
   retirement is unstudied anywhere (our 2026-08-22 research) and the
   consolidation-allocation question is the field's named open problem. A
   nightly sweep that *marks* a principle whose citing signals have all
   faded — rendered as a state for the owner to resolve (reaffirm =
   redemption's mirror; release; delete) — gives WAKA a principled answer
   to lifecycle without the machine ever demoting the person's values on
   its own.
3. **Quote re-verification on capture edit.** The field gap "re-verify
   remembered facts against sources" is structurally cheap here because
   the sources are internal: when an inspiration's text is edited,
   re-run `verifyQuote` over the evidence rows that cite it; a quote no
   longer present in the person's words is dropped to honest-null (the
   evidence link survives; the quote claim doesn't). Extends "no
   invented quotes" to "no *stale* quotes."
4. **Self-reinforcement as a rendered state on agent stacks.** The
   Databricks loop (an agent feeding its own pattern until it reads as
   precedent) can't touch the human stack but is exactly the risk inside
   an agent's own profile. The confidence machinery already knows
   source and burst shape; render a pattern fed only by its own
   profile's captures in a tight window as a visibly different state on
   the agent's wall — the human admin's poison-review surface, as light,
   no numerals. OWASP builds this as middleware; for us it is one more
   computed state.

### Refuse, as standing stances (kill-list additions)

- **No neighbor rewriting.** A-Mem-style "new memory rewrites old ones"
  is the documented error-propagation vector; match-or-mint plus owner
  merge stays the answer. The sanctioned cousin is pairing: a sweep may
  *mark* (contested), never rewrite.
- **No closed loop.** The field's gap #1 — detect → autonomous revert —
  is not a gap for us; it is the doctrine holding. Detection may be
  autonomous; reversion is an owner verb (`revert` exists, chains make
  it byte-exact). An automatic reverter is the machine picking.
- **No autonomous profile re-synthesis above the line.** Dreaming's
  recall gains are real; so is the drift nobody measures. Our
  re-synthesis stays citation-validated, lock-preserving, and versioned
  — and the unbuilt "rewrite drift after N cycles" benchmark is one our
  chains could define, the way tensions-preservation already is.

### Say (claims the research licenses)

- Locks are the "user-lockable constitutional entries that evolution
  provably cannot rewrite" — named as existing nowhere; shipped here.
- WAKA is a *governed self-evolving memory*: everything the
  self-evolution literature says must exist for safety (immutable
  anchors, external enforcement, append-only history, diff-and-approve)
  is either live or one queue item away.

---

Method note: product and paper claims above are from the 2026-08-30
research pass (verification flags preserved there); WAKA-side claims are
canon, current at this commit. This doc feeds the standing queue, not a
new goal: items 1–2 belong beside the legible-loop and no-quiet-corners
lineages; 3 is an afternoon beside `verifyQuote`'s wiring; 4 rides the
aliveness/state machinery.
