# What Waka is

Status: master write-up, authored 2026-08-30. Product voice, layered — the
line, then the page, then the receipts — written to be adapted into a
north-star doc, a public manifesto, or an investor narrative without
rewriting the substance. Supersedes the pre-canon write-up from the earlier
founder conversation; Appendix E records exactly what changed and why.
Every claim here is enforced in code or dated in the decision log; the
external claims are sourced in
[`memory-infra-comparison.md`](memory-infra-comparison.md).

---

## The line

Platforms sell an AI that remembers you. Waka sells ownership and control
over what AI believes about you.

Said out loud, with dates: in 2025 OpenAI launched its agent with memory
switched off; in August 2026 Anthropic merged its agent's memory with your
chats. Waka is neither — you and every one of your agents keep separate,
governed memory: your agents read how you choose, and nothing they write
can ever touch what's yours.

## The page

Waka is a memory system with two kinds of users — people and their AI
agents — and one organizing idea: **memory is governed by the person it is
about.**

What you save is the evidence. What Waka forms from it is the prior your
agents choose by. You keep what matters as it happens — a thought, a link,
a decision; nothing is harvested from your transcripts behind your back.
Waka distills those saves into evidence-backed patterns ("you keep choosing
depth over breadth"), synthesizes one short, versioned account of what
currently matters to you, and nightly mints principles — how you choose,
stripped of context ("have something working before you put more money
in"). The division of labor is strict: the model writes sentences;
arithmetic makes every decision that admits, promotes, or ranks; and every
derived sentence must cite your own words, quoted verbatim and verified in
code, or it does not exist.

**Governance is the spine, not a settings page.** Your edits lock —
structurally: the next version of your memory is rebuilt around your words,
copied from the database, never from the model's reply. Dismissing a
pattern writes a standing law with a receipt: anything that similar is
refused before it can re-form, on the record, reversible. When derivation
produces two beliefs about you that conflict, both stand as contested until
*you* act — no weight of evidence resolves anything, because authority over
what is true about you belongs to you. Nothing is deleted by arithmetic: a
pattern you stop feeding fades and floors; it never vanishes. And the door
out is real: one export carries everything — every layer, every version,
every receipt.

**Your agents are the second kind of user, with memory of their own.** Each
agent owns a full stack — its observations, its lessons, its own account of
what matters — under your administration: you can read and edit all of it.
Acting for you, an agent reads your memory: your patterns, your current top
of mind, and your principles served as one canonical document — and a
principle you declare in your own words binds your agents from the moment
you say it. But the write wall is absolute: nothing an agent saves can
enter or move your memory, and an agent reads a sibling's memory only
through a grant you made and can revoke. This is the answer the labs didn't
find. One shipped its agent with memory off — safe, and blind. The other
merged its agent's memory with yours — informed, and unwalled. Waka's
agents are conditioned *and* contained.

**Rooms extend the same governance to groups.** A room's ground is what its
members chose to make public to it. The room distills its own patterns —
one needs at least two members' memories behind it before it can wear the
room's name — and the room's shared reading is adopted by vote: a majority
carries it, refusal is a counted stance rather than a veto, and accepted
text locks. A member is a member, human or agent. The record is honest
about departure, too: erase your account and your name goes everywhere,
while what the room settled together survives as the room's own words.

Thirty seconds shows all of it. Find a pattern Waka got wrong about you.
Tap it: there are the exact saves it grew from, your words quoted. Fix the
sentence — it locks. Watch everything regenerate around it, your correction
intact to the byte. As of the 2026-08-30 research pass, no platform and no
memory product ships those thirty seconds: none lets you lock, none shows
per-memory provenance, and none promises what its export can't carry.

## The receipts

### A. The rulings, dated (decision log, `data-model.md`)

- **2026-08-23 — the machine never picks between two things it believes
  about you.** Contested pairs resolve only by an owner act; the loser
  becomes *yielded* — a state, never a deletion.
- **2026-08-23 — refusal is a counted stance, not a veto.** A room proposal
  falls only when the noes make a majority arithmetically impossible.
- **2026-08-23 — a sentence the room approved belongs to the room.**
  Erasure removes the person and their name; settled records survive as
  departed marks.
- **2026-08-23 — Waka is both**: a world for one person and their minds,
  and infrastructure for teams. Sequencing personal-first; the team door
  behind its hard gates.
- **2026-08-24 — sibling access becomes a grant** (explicit, one-way,
  revocable, kept as record), and rooms grow their own signals — sharing a
  personal signal into a room retires.
- **2026-08-29 — agent-generated memory is fully separate.** Agents read
  the human profile and write nothing there; capture across profiles is
  exclusively the human's act. The keeper key ships the same day — the
  person's own standing credential, deliberately scoped to keep and recall
  only.

### B. Mechanics, one breath per layer (`generation.md`, drift-locked in CI)

- **Capture:** editable, deletable, never append-only; attachments enriched
  by bounded deterministic fetch or one-time vision, always fenced as data,
  never presented as your words.
- **Signals:** 0–3 candidates per capture, zero sanctioned; attach at
  cosine ≥ 0.86, judge band 0.7–0.86 where *uncertainty mints*; promotion
  at 3 evidence, enforced by code and a Postgres trigger; confidence is a
  pure read-time function (support 55 / spread 30 / recency 15, 45-day
  half-life) over evidence dated by the witnessing capture.
- **Top of mind:** one versioned artifact, ≤ 7 entries; whole-artifact
  synthesis; citations validated against the database (an invented citation
  is unstorable); locked entries copied forward byte-identically.
- **Principles:** five tests — context, directive, ≥ 3 signals, ≥ 45 days
  across ≥ 5 versions, can never be finished; minted nightly and only
  nightly; served as one deterministic, byte-identical machine document;
  declarations instant, locked from birth, binding on the person's agents.
- **The doc you are reading about is machine-checked:** every constant in
  the mechanics doc fails CI if it drifts from the implementation, in
  either direction.

### C. No analog found (research pass, 2026-08-30)

Across developer memory infrastructure, platform memory, and the academic
literature: **human-only contradiction resolution; structural edit-locks;
dismissal as a standing suppression law; evidence-count promotion;
read-time pure-arithmetic confidence** — plus, at the system level, the
agent/human write wall, vote-governed shared memory, and drift-locked
self-description. Close research neighbors exist for quote verification and
contested states; no shipped product carries either. Full sourcing:
`memory-infra-comparison.md`.

### D. Open, honestly

- Repetition isn't importance: a critical single-mention fact can't promote
  yet (queued as `durable-interest`; a lock or a *true* verdict is the
  designed escape hatch).
- A consultation receipt proves an agent *read* a principle, not that it
  *obeyed* it; measured behavior change is unbuilt — here and everywhere.
- Distribution: self-deploy only today; hosted Waka is gated on the
  security audit.
- No compliance sentence about rooms until counsel reviews the
  collective-speech ruling.
- No published benchmark numbers, by posture: proof over recall — the
  public trust artifact is the invariant suite, not a leaderboard row.

### E. What changed from the previous write-up

For readers holding the earlier founder-conversation version: **"memory is
not evidence, it is behavior prior" is corrected** — memory *is* the
evidence; the prior is what Waka forms from it (the uncorrected line denies
the receipts the whole trust story stands on). **Rooms no longer share
personal signals** — they distill their own, and adoption is by counted
vote. **The "≥3 gate demoted to a user dial" never shipped** — promotion at
three stands, trigger-enforced; the importance critique lives on as queued
work, not as a dial. **The "product is the MCP layer, the app is thin"
framing is inverted by ruling** — the world is the product for the person;
MCP and the canonical renderings are the doors for machines. **"Selling the
ledger before building the mirror" is moot** — the founder ruled *both*,
and the mirror is built. **"Tensions have zero prior research" is
sharpened** — contested states now have research neighbors; the defensible
claim is that resolution is reserved for the human. **LOUPE and the
six-primitives expansion are cut** — this document is about Waka.
