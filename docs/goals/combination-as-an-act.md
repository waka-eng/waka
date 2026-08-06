# Goal: putting signals next to each other is a cheap act

Status: not started
Branch: `goal/combination-as-an-act`
Depends on: ambition-reading (introduces `combinations`)
Decided by founder, 2026-08-01: room subsets + handshake combinations (open
pool consent lands in `finding-your-people`)

## Why

"Who you sit next to isn't a social choice — it's how you find out who you
are." Then re-seating must be nearly free. Today a combination is a persistent
room: create, invite, wait. You cannot ask "what would my signals and just Se
One's reveal?" without founding a small institution.

And when a combination stays silent, the silence is illegible: "you're not on
this board" collapses four different truths — never asked, asked and refused,
found and lost, found and pruned. Distinguishing them by hand took a full day
of this project's history. A person's emptiest state should be the product's
most honest sentence.

## Phases

### Phase 1 — Combinations carry the machinery

- Extend `combinations.origin` with `subset` and `handshake`.
- Notes and readings key to `combination_id`; each room's board becomes its
  root combination (migration; rooms keep working unchanged).
- `last_synthesis_at` cooldown moves from groups to combinations.
- Canonical `member_set_hash` (sorted user ids): re-reading the same set is
  the same combination — cached, idempotent, refreshable. Invalidate when a
  member's shared-signal set changes materially.

**Gate:** existing room boards unchanged after migration (eval before/after,
3 runs, medians); a combination created twice for the same set resolves to one
row.

### Phase 2 — Subsets: re-seat inside a room, free

Consent basis: room membership already given. From the room's cast, select
hearts → read. Async (a reading takes ~2 min): the surface says it is reading,
then reveals — arrival, not a spinner lie.

**Gate:** Yunji + Se One as a subset of Waka produces an end-to-end reading in
the browser without creating a room.

### Phase 3 — Handshake: combinations across room lines

- `combination_invites`: proposer, invitees, message, status, expiry.
- All parties accept → the reading runs; visible **to participants only**.
- "Keep this" promotes a combination to a room (standard join consent — never
  automatic membership).

**Gate:** two test accounts complete propose → accept → read → keep in the
browser. Decline and expiry paths verified.

### Phase 4 — Legible silence

Store per-member pass stats on every synthesis: asked count, refusals by
reason, cited count, load-bearing grade. Surface them:

> "4 of your signals were asked. None combined yet — the judge couldn't find a
> pattern that needed you both. That changes as you save."

**Gate:** the four historical failure modes (never-asked / refused / lost /
pruned) each render distinguishably from stored data, not inference. A
DB-backed test constructs each state.

### Phase 5 — Budgets scale with hearts, not constants

`MAX_TRIGGERS=24` and `TARGET_NOTES=6` are absolute: a 20-person combination
gets one trigger per member; past 24, some are structurally unaskable.

- Triggers: `clamp(2..4) × members`. Notes target scales with members.
- Hard member cap per synthesis (12) — beyond it, sample **and say so** (no
  silent caps).
- Per-user daily reading budget; per-combination cooldown (already moved here).

**Gate:** synthetic 2-member and 12-member groups both reach every member in
the eval (3 runs, medians). Cost per reading stays ≤ ~$0.10 at the cap.

## What this goal will not do

- Infer consent. Subsets ride on room consent; everything else is a handshake.
- Make readings public. A combination's reading belongs to its participants.

## Budget

No new model surface — reuses synthesis + reader. Development/eval ≈ $2.
Ongoing: readings are user-triggered at ~$0.05–0.10, rate-limited.

## Acceptance

- A combination is a first-class, cacheable object; rooms are one origin of it.
- Reading a subset costs one tap and no new social structure.
- A handshake combination works end to end between strangers to a room.
- Absence is explainable from stored state everywhere a board renders.

## Log

_(phases append numbers and verdicts here)_
