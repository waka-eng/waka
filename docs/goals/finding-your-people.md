# Goal: find people by what makes hearts beat together

Status: not started
Branch: `goal/finding-your-people`
Depends on: combination-as-an-act (handshakes, readings)
Decided by founder, 2026-08-01: full discovery in this plan, open-pool consent
included, knowing the pool starts thin.

## Why

Groups form by join code — you invite people you already know, which is school
and title's front door wearing our clothes. Nothing in the product can yet say
"your signals would combine unusually well with this person's." The vision's
endgame: *finding your people can't be done by school or title. Only by what
makes your hearts beat together.*

## Consent architecture (the load-bearing decision)

Two tiers, so being findable never means being readable:

- **Pool** ("I can be found") — explicit opt-in, default off. Your shared
  signals join resonance computation. Pre-handshake, another person can see
  **only their own side**: which of *their* signals reach strongly toward
  someone — never your text, never your name attached to content.
- **Handshake** ("we can be read") — a match becomes a reading only through the
  handshake built in `combination-as-an-act`. Discovery proposes; consent
  disposes.

## Phases

### Phase 1 — Pool consent

Settings surface: what joining the pool means, in plain words; per-signal
sharing continues to gate what participates (`shared_to_groups` signals only).
Leave the pool → out of the index at next build, matches referencing you gone.

**Gate:** browser-verified opt-in/opt-out; index respects departure.

### Phase 2 — The resonance index

Nightly worker, pairwise over pool members. **Sharpness over averages** — the
central lesson of group-note-coverage: agikee had the *highest mean* similarity
and nothing sharp, and mean-thinking misread them for a week.

```
resonance(A,B) = f( best cross pair,
                    count of pairs > τ (sharp pairings),
                    breadth — distinct signals of A involved )
```

Stored with explainers: which of *your* signals do the reaching. O(U²·s²) is
fine at current scale; pgvector/ANN is the flagged path when it isn't (the
repo already carries that TODO).

**Gate — the founders test.** The index runs over the four founders plus
everyone else in the pool. Three years of building together twice a week is
ground truth: **the four must rank in each other's top quartile from signals
alone.** If the index cannot rediscover the relationship the vision is built
on, the surface does not ship. This gate is not softenable.

### Phase 3 — "Hearts near yours"

- Ranked matches; each shows only your outward side: "your save about physical
  ritual reaches strongly into someone's collection" → **[ask]** → handshake.
- Thin-pool honesty: show the pool's actual size; never pad, never fake.
  "12 hearts in the pool so far" is the true sentence at launch.
- Accepting runs the reading — the product's answer to "why you two," in words,
  as the first thing two matched people ever see of each other.

**Gate:** founders test passing; end-to-end match → ask → accept → reading in
the browser; a pool member who leaves disappears from every surface.

### Phase 4 — Depth after contact

A handshake reading that reveals an ambition offers "keep this" (room). The
funnel is: found → asked → read → building together. Instrument each step —
cut rate between steps is the health metric (per the heartbeat roadmap), never
a growth number on the surface itself.

## What this goal will not do

- Show anyone another person's signal text, name-attached content, or identity
  before a handshake is accepted.
- Pad thin results. An empty pool reads as an empty pool.
- Rank by anything but resonance — no activity, recency, or popularity terms.

## Known caveat: one heart, one account

Duplicate accounts inflate resonance and can make one person their own match
(Jaegyu holds two accounts today; the zep.us one is ignored per founder
decision). Before the pool opens beyond trusted users, account-merge or
dedupe-by-signal-overlap needs a policy. Tracked here so it cannot be
forgotten; not solved in this goal.

## Budget

Index is embeddings-only — no judge calls; compute is pennies nightly at this
scale. Readings triggered through matches use the standard ~$0.05–0.10.
Development/eval ≈ $1.

## Acceptance

- Pool consent exists, honest and reversible.
- The resonance index passes the founders test.
- A stranger-to-stranger path exists: found → ask → accept → a reading that
  says why, grounded in both hearts' signals.
- Every pre-consent surface shows only the viewer's own side.

## Log

_(phases append numbers and verdicts here)_
