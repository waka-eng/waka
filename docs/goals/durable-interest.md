# Goal: what survives the novelty — storage strength for context nodes

Status: halted 2026-08-09 at the Phase 1 gate. After the writer-gap backfill
made 28 d labels real, the recency null wins the only askable v1 horizon
(AUC 1.00 vs E[R] 0.80; 90 d unobservable until data passes 2026-08-30), and
the founder-approved return-label criterion v2 fails marginal at 7 d and
outright at 14 d. Phase 0 shipped and gated green; the harness and backfill
are committed; the archive is too young for the month-and-quarter question
this goal exists to answer. See `## Log`.
Branch: `goal/durable-interest`
Follows: `brain-inspired-spark-engine.md` (S1+S2 shipped), `memory-movement.ts`,
ambition-reading. Runs beside `two-modes.md` without collision: this goal
changes what stickies and boards *rank on*, not what they are — no shared
files until the read-side phase, which lands behind the two-modes surface.

## Why

The founder's words, which `two-modes.md` is judged against, end like this:

> My priority is to place myself where my pulse still races **after the
> novelty wears off**.

That sentence names two different quantities, and today's arithmetic only has
one of them. The spark engine's `activation` (half-life 7 days) is a faithful
racing-pulse detector — cognitive science calls it *retrieval strength*, the
"alive right now" axis, and it shipped. What nothing in the codebase computes
is the second axis: which pulses **survive the novelty** — *storage strength*,
the slow variable that grows only through spaced return and never decays.
The spark-engine doc already promised it a row in its own mapping table
("Long-term potentiation | node `weight`/`confidence` | recomputed during
consolidation") and left it as design. This goal builds it.

The cost of not having it is visible in four specific behaviors of the current
code, each one scoring exactly backwards against the founder's sentence:

1. **An obsessive week outranks a steady year.**
   `memory-movement.ts` grows `currentWeight` by `+12` per recent
   reinforcement, linearly. Ten evidence rows in one hot week buy 120 points;
   ten rows spread over ten months buy the same — then lose it to decay. The
   spacing literature is unambiguous that the second pattern is *the* signal
   of durable interest and the first is nearly noise, and the effect is
   quantified: massed repetitions add almost nothing to long-term retention.
   Novelty is precisely what current weight measures best.

2. **The comeback earns a state but no credit.**
   `reactivates_dormant` exists (gap ≥ 60 d) — the state machine notices the
   return. But the node's *weight* gains the same `+12` as any other
   reinforcement. A theme that comes back after 14 silent months survived 14
   months with zero reinforcement; that is the strongest durability evidence a
   capture log can produce (formalized four separate times: ACT-R's
   spacing model, Bjork's storage/retrieval theory, SuperMemo's stability
   increments, FSRS's `e^(w·(1−R))` term). It should be worth a multiple, not
   an increment — and an every-January return should be worth almost nothing,
   because ritual is not pull. Neither distinction exists today.

3. **Resolution reads as decay.**
   `decays_by_omission` subtracts weight from any pattern recent signals
   didn't touch. But a goal can go quiet because it was *consummated* —
   "signed the lease" — and concern theory says recurrence lawfully collapses
   at consummation. The person who finished the thing gets scored like the
   person who drifted away from it. Silence has at least four causes
   (resolved, satiated, fading, seasonal), they have published, testable
   signatures, and the current arithmetic prices them identically.

4. **Freshness decay is exponential; interest decay is not.**
   Every decay in the codebase (`0.5^(age/30)`, `0.5^(age/7)`) is exponential.
   Memory follows power laws — measured in environmental event streams and
   adopted by every modern spaced-repetition system. The practical difference:
   under an exponential, a theme with eighteen months of history bleeds
   standing as fast as last week's flash. Under a power law it doesn't —
   which is exactly the discrimination "after the novelty wears off" asks for.

None of this is a criticism the field has solved either: a 2026 survey across
agent-memory systems, spaced-repetition engines, and recommenders found *no
shipped system* that counts spaced returns, rewards dormancy survival, or
labels silence by cause. The ingredients are all published; the combination is
open. WAKA is unusually close to it — the evidence log, the revisit events,
the state machine, and the consolidation slot all already exist.

## The mapping

| model concept | WAKA today |
| --- | --- |
| item / capture event | `signal`, `meaning_evidence` row citing a node |
| theme (unit of scoring) | `context_node` |
| graded engagement events | `signal_revisit_events` (enum already graded by type) |
| capture effort | `contentDepth` + `elapsedMs` pulse proxy (already stored) |
| retrieval strength R ("alive now") | `activation` (7 d half-life) — shipped, keep |
| **storage strength S ("durably me")** | **missing — this goal** |
| stated interests (awareness axis) | adopted ambition readings + direction statements |
| discovery surface | stickies / wow moments ("ones I never knew I had") |
| consolidation slot | spark-engine S3 sleep cycle (design, unbuilt) |

## Approach: a two-component state per context node, updated by evidence

Alongside `activation` (untouched), each context node gets **S — stability,
in days**: how long a gap this node has *proven it survives*. S never decays.
It grows only when evidence arrives, and how much it grows depends on how
decayed the node was when the evidence landed.

**Retrievability** (power-law forgetting curve, FSRS form — replaces nothing
yet; it is the lens S is updated through):

```text
R(t, S) = (1 + (19/81) · t/S)^(-0.5)          # R(S, S) = 0.9
```

**The update.** Events for a node = its evidence rows plus revisit events on
its supporting signals, day-collapsed per node (same-day events keep the best
grade; a binge is one event — the session-cap discipline `activation.ts`
already applies to charges). Replayed in time order:

```text
first event:   S = 7 days
later events:  R_pre = R(gap_days, S)
               d     = 1 − R_pre                        # how decayed at return
               if calendar-locked: d = min(d, 0.25)     # ritual cap, see below
               S    *= 1 + 2.0 · q · S^(−0.25) · (e^(2.5·d) − 1)
```

Three factors, three laws, one line each:

- `e^(2.5·d) − 1` — the **dormancy bonus**. Evidence landing while the node
  is hot (R ≈ 1) multiplies S by ≈ 1.0: the hot streak buys nothing durable.
  Evidence returning from deep decay multiplies it by 2–3×. Cumulative: three
  four-month comebacks compound. This is behavior 1 and 2 fixed by the same
  term.
- `S^(−0.25)` — **saturation**. Already-stable nodes are hard to grow.
  Consequence worth stating plainly: S calibrates to the *demonstrated
  survival horizon*. A node fed monthly plateaus near S ≈ 90 — it has proven
  it survives ~35-day gaps and nothing longer. Only longer survived gaps push
  it up. Frequency alone can never buy what spacing proves.
- `q` — the **event grade**, from the existing enums, ordered by the
  testing-effect hierarchy (re-generation > re-exposure > glance):

  ```text
  evidence from a new signal      q = 0.55 + 0.45 · contentDepth(signal)
  reflection_created              q = 0.80      # retrieval practice
  inspiration_updated             q = 0.80      # elaboration
  detail_returned / detail_opened q = 0.45      # re-exposure
  capture_saved                   never charges its own node (same rule
                                  activation.ts already enforces)
  ```

**Silence diagnostics** — computed per node from its capture-event gaps, so
every threshold is the node's own cadence, not a global constant:

```text
envelope    = max(30 d, 3 × median gap)         # "normal quiet" for THIS node
silent      = open gap > envelope
stretching  = last 3 gaps strictly increasing AND last ≥ 1.5 × median
              # the published abandonment signature (gaps stretch before quit)
calendar-locked = Rayleigh phase test on the annual circle:
              R̄ = |Σ e^(iφ)|/n,  p ≈ e^(−n·R̄²)
              flag if n ≥ 5, events span ≥ 2 years, p < 0.05
closure     = consummation captured in the final evidence ("signed the
              lease", "done with", "gave up on") — judged, not substring-
              matched, and only ever high-precision: a missed closure is
              honest, a wrong one erases a live concern
```

**States.** `memoryStateValues` keeps its existing members (`contradicted`
and `needs_testing` are orthogonal and untouched) and the derivation is
restructured; one value is added:

```text
— silent nodes (open gap > envelope) —
resolved     NEW: closure detected — goal consummated; S preserved
fading       stretching-gaps signature — progressing abandonment
dormant      flat gaps then silence — return plausible
             (+ calendar-locked ⇒ "likely returns in season")
— active nodes —
reactivated  evidence arrived over a gap ≥ 120 d with R_pre < 0.60,
             within the last 120 d      (replaces the fixed 60 d rule:
             the comeback must be deep, not merely late)
emerging     first evidence within 90 d
active       S ≥ 60 d
```

`decays_by_omission` stops subtracting weight. It becomes a *label*
(`fading`/`dormant`/`resolved` per the tests above) — attention remains
scarce, existence is never punished. Files accumulate; only ranking moves.

**The two scores that replace `movementScore`'s inputs:**

```text
S_norm     = min(1, ln(1 + S/7) / ln(1 + 365/7))
Importance = 100 · S_norm^0.85 · max(sourceDiversity, 0.05)^0.15
Discovery  = Importance · (1 − Awareness)
```

`sourceDiversity` = distinct capture channels among supporting signals,
`(min(n,4)−1)/3` — one newsletter echoing is one exposure. `Awareness` = how
close this node sits to anything the person has *said* they want: embed the
adopted ambition readings and direction statements, take the node's max
similarity **rank-normalized as a z-score against the per-ambition
similarity distribution over all signals** (absolute cosines are
uncalibrated; z ≥ 4.5 ⇒ aware, z ≤ 3.0 ⇒ unaware, measured on real data in
Phase 5), with the final call made by the judge over the node description and
sample evidence. High Importance × low Awareness is the product's founding
promise, as a ranking: **"ambitions reveal themselves, including ones I never
knew I had."**

## The decision that matters

**Storage strength never decays, and silence never costs until it has a
cause.** That is the reversal of the current arithmetic, where omission
subtracts weight on a fixed clock. Under this goal, a quiet node keeps every
day of stability it earned; what silence changes is its *state* — resolved,
fading, dormant — each assigned by a test, each rendered differently, none of
them a subtraction. Bjork's axiom, adopted whole: forgetting is loss of
access, not of the trace. The person who finished the thing and the person
who drifted from it finally score differently.

The second decision: **durability is a prediction target, not an aesthetic.**
"Durably important" is *operationalized* as "predicts whether this node
receives evidence over the next month and quarter" — the long-horizon
objective that made industrial recommenders' interests durable. Every formula
above is judged by held-out forward replay on real archives, against the
current arithmetic and against a recency-only null. If the new state loses to
`currentWeight` at prediction, the honest verdict is that the theory didn't
survive contact with the data, and the goal halts.

## Phases

### Phase 0 — the pure math, refused until it reproduces the laws

`packages/api/src/scoring/stability.ts`, mirror of `activation.ts`: pure
functions, every constant named with its rationale, no DB imports. Unit tests
in the `vitest.unit.config.ts` allowlist (a test that never runs looks
exactly like a test that passes).

**Gate:** the four planted trajectories reproduce, asserted not sampled:

| trajectory | assertion |
| --- | --- |
| 15 events at ~35 d spacing | S plateaus in 80–110 d; final 3 increments each < 15% |
| same 15 events in one week | S ≤ 12 d (≤ +70% over S_INIT, vs ~13× when spaced) |
| 4 events, 14 mo silence, 3 events | the comeback event multiplies S by ≥ 2.0; final S > the steady-week case by ≥ 5× |
| the comeback, but calendar-locked | comeback multiplier ≤ 1.6 (ritual cap holds) |

### Phase 1 — the replay harness, before any schema

`packages/api/scripts/replay-stability.ts` (or `tools/`): for each user
archive, walk monthly cuts T; score every node with ≥ 2 prior capture events
using only data ≤ T; label = node receives evidence in (T, T+28] and (T,
T+90]; pool AUC across cuts. Predictors: recency null (days since last
evidence), current `currentWeight`, current `movementScore`, mean
`importanceScore` of supporting signals, new `S`, new `E[R]` (mean R across
the horizon). Pure DB reads and math — **zero model calls, zero cost**.

Run on the founder archive and the demo seed. Record every number in `## Log`.

**Gate:** `E[R]` or `S` beats *both* the recency null and `currentWeight` at
both horizons on the founder archive. Marginal (inside small-n noise) is a
fail, per the goal command. If the gate fails, stop — the writeup of *why*
the old arithmetic predicted better is the deliverable.

### Phase 2 — the columns

`context_node_dynamics` (or columns on `context_nodes`): `stability` (real,
days), `stabilityUpdatedAt`, `lastEventAt`, `stateDetail` (jsonb: envelope,
open gap, stretch flag, Rayleigh p, closure). One migration, `pnpm db:check`,
nothing reads it.

**Gate:** migrations apply cleanly; no behavior changes; typecheck green.

### Phase 3 — the write path

Fold S updates where activation already folds charges: evidence writes in
`meaning-graph-writer.ts`, revisit/reflection/edit pulses in
`routes/inspirations.ts` — same event taps S1 already installed, one extra
fold each, day-collapsed per node. Backfill = replay each node's existing
evidence + revisit history through the Phase 0 module (idempotent,
re-runnable; order by createdAt).

**Gate:** backfill on the founder archive completes; for 5 hand-picked nodes
(one steady, one burst, one comeback, one seasonal, one resolved) the stored
S and stateDetail match the Phase 0 math run by hand on their event lists.
Recorded in `## Log`, node ids and numbers.

### Phase 4 — the state machine speaks the new states

`memory-movement.ts` restructured: `deriveState` consumes the diagnostics
(envelope/stretch/closure/Rayleigh) instead of fixed 45/120 d constants;
`resolved` added to `memoryStateValues`; `reactivates_dormant` requires the
deep-comeback rule; `decays_by_omission` emits state without touching weight;
`movementScore` recomputed from S, R (existing activation), state, and
confidence. `contradicted` and `needs_testing` derivations untouched.

**Gate:** existing memory-movement unit tests updated and green, plus new
cases: consummated node → `resolved` not `fading`; stretching-gaps node →
`fading`; flat-then-quiet seasonal node → `dormant` + calendar-locked; the
January node's dormancy bonus capped. `pnpm --filter @waka/api test:unit`
green.

### Phase 5 — the readers: boards rank on it, discovery means it

Consumers switch from `currentWeight` ordering to the new pair where each
surface's intent demands it: top-of-mind candidate pools weigh `E[R]` (alive)
× state; sticky/wow discovery ranking weighs `Discovery` (Importance × low
Awareness vs adopted ambitions); the ambition-synthesis trigger
`memory_movement` fires on state *transitions* (→ reactivated, → resolved,
→ fading) rather than weight deltas. Awareness z-thresholds measured on the
founder archive and recorded before use.

**Gate:** side-by-side on the founder archive, recorded in `## Log`: top-10
by old `currentWeight` vs top-10 by `Importance`, and top-10 `Discovery` vs
adopted ambitions. The founder judges blind which list better answers "what
still races after the novelty wore off" and "what did I never say out loud."
A coin-flip verdict is a fail for the surface switch (the scoring stays; the
ranking swap reverts).

### Phase 6 — the sleep cycle owns the slow math

The S3 consolidation job (spark-engine §5, design → built here for scoring
only): nightly, idle-gated, per user — recompute diagnostics (envelope,
Rayleigh, stretch, closure judging via the existing judge with a bounded
batch), refresh states, decay-prune activation rows as §5 already specifies.
Closure judging is the only model spend: batched, ≤ 1 call per newly-silent
node, capped per cycle.

**Gate:** cost per user-cycle measured and recorded; job idempotent
(re-run produces identical states); no visible reorganization outside the
idle window.

## Budget

Phases 0–4 are pure math and DB: zero model calls. Phase 5 adds bounded
awareness judging (≤ 1 call per node above the Importance median, once, then
cached on the node). Phase 6 adds ≤ 1 closure call per newly-silent node per
cycle. State expected counts before running either phase; halt at 2× estimate
per the goal command.

## What this does not do

- **No numeric score ever reaches the user.** Vault Principle 3 already says
  scores never enter files; this goal extends the same rule to the UI, on
  evidence — measurement visibly changes the behavior being measured, and a
  self-knowledge tool that shows its numbers corrupts its own instrument.
  States, evidence, and questions render; S and R do not.
- **The judge stays sovereign.** Arithmetic proposes, judgment disposes —
  S/R decides *when to look and how to rank*, never what is true about a
  person. Same division of labor S1/S2 shipped with.
- **The per-signal WOW pipeline is untouched.** `wow-score.ts` and
  `inspiration-scores.ts` keep scoring individual saves at capture; this goal
  operates one level up, on context nodes, where the durable claim lives. If
  Phase 1's harness shows the per-signal freshness/time terms mislead, that
  is a separate goal with its own gate.
- **Nothing is deleted, ever.** Dormant and resolved nodes keep their
  evidence, their S, and their reactivation rights. Importance affects
  surfacing, never existence — the stance the spark-engine doc already took
  against promotion-as-survival.

## Non-goals

- Predicting *content* (what the person will save next). Only cadence — will
  this concern receive evidence again — is claimed or measured.
- Cross-user priors. Every parameter is fit or defaulted per user; the
  founder archive is the first eval, not a template.
- Re-clustering or renaming nodes. Node identity is the trust anchor
  (`user_type_label` uniqueness); this goal scores existing nodes and never
  silently reshuffles them.

## Later, if the gates pass

Held deliberately out of scope, in priority order, each a candidate goal:

1. **Resurfacing as probing** (completes S4 protention): schedule
   re-encounters proportional to `1 − E[R]` under a capped budget; the graded
   response (elaborate / glance / ignore) is the cleanest revealed-preference
   event the system can collect, and the same feature is the most replicated
   user benefit in forty years of personal-informatics research.
2. **Intensity as forecast**: emotional heat at capture is logged as a claim
   and credited only when future behavior confirms it — hot language is the
   talk-yourself-into-it channel.
3. **Cross-state certification**: a node evidenced in different moods, hours,
   and seasons outranks one fed from a single state; protects against
   peak-end and projection bias.
4. **Learned parameters**: once enough re-evidence history exists, fit
   BOOST/SAT/DORM per user against the Phase 1 objective (half-life-regression
   style) instead of shipping constants.

## Log

(append measurements here, per the goal command)

### 2026-08-09 — Phase 0: pure math (gate PASS)

`packages/api/src/scoring/stability.ts` + `stability.test.ts`, allowlisted in
`vitest.unit.config.ts`. 32/32 tests green; `tsc --noEmit` clean. All events
below graded at contentDepth 0.5 ⇒ q = 0.775.

| trajectory | criterion | measured | verdict |
| --- | --- | --- | --- |
| 15 events @ 35 d | S ∈ [80, 110]; final 3 increments < 15% | S = 92.333; ×1.069, ×1.064, ×1.059 (6.9%/6.4%/5.9%) | pass |
| same 15 in one week | S ≤ 12 (≤ +70% over S_INIT) | S = 8.579 (+22.6%); day-collapsed 15 → 7 events | pass |
| 4 events, 14 mo silence, 3 events | comeback × ≥ 2.0; final ≥ 5× massed | ×2.782; final S = 92.751 = 10.81× massed | pass |
| the comeback, calendar-locked | comeback × ≤ 1.6 | ×1.577 (uncapped ×2.782; cap binds at d = 0.25) | pass |

The doc's parenthetical "~13× when spaced" measures at 13.19× (92.333 / 7).

Suite note: `src/routes/admin-meaning-graph.test.ts` has 1 pre-existing
failure on clean dev (f1feda0), verified by stash/rerun in this session —
unrelated to this goal; 173/174 remaining tests pass.

### 2026-08-09 — Phase 1: replay harness (gate FAIL — halted)

`packages/api/scripts/replay-stability.ts`. Read-only SQL + pure math, zero
model calls, deterministic (bootstrap PRNG seed 42). Baselines reconstructed
as of each cut T through the production `deriveMemoryPattern` (node.weight =
Σ evidence.weight ≤ T, confidence = max ≤ T — the writer's own aggregates;
status transitions are unlogged, so contradiction never fires in
reconstruction). Evidence events grade at flat contentDepth 0.5 ⇒ q = 0.775
(depth is not persisted anywhere in the schema). E[R] uses the closed form
in `meanRetrievabilityOverWindow`.

Founder archive (yjchung9806@gmail.com): 95 evidence rows, 588 graded
revisits, 18 nodes, span 2026-05-25 → 2026-08-10, 3 monthly cuts.
Evidence by month: **2026-05 = 56, 2026-06 = 0, 2026-07 = 0, 2026-08 = 39.**

| cut | eligible nodes (≥2 prior) | evidence in +28 d | evidence in +90 d |
| --- | --- | --- | --- |
| 2026-06-01 | 6 | 0 | 2 (censored) |
| 2026-07-01 | 6 | 0 | 2 (censored) |
| 2026-08-01 | 6 | 2 (censored) | 2 (censored) |

Pooled, after right-censoring: **28 d → 12 node-cut pairs, 0 positive; 90 d
→ 0 observable pairs.** AUC undefined for every predictor (recency,
currentWeight, movementScore, meanSignalImp, S, E[R]) at both horizons —
single-class labels. ΔAUC bootstrap: n/a.

Other archives: agikeekim (35 rows, span Aug 4–7, 0 cuts), jqyu.lee (17
rows, one day), korean.tech.initiative.dev (10 rows, one day), ljk950327
(4 rows). No demo-seed archive with multi-month history exists (seed/test
users hold ≤ 2 rows each).

**Gate criterion:** E[R] or S beats both recency and currentWeight at both
horizons on the founder archive, outside small-n noise. **Measured:** AUC
undefined everywhere — the eval is structurally unrunnable on 11 weeks of
bursty (backfill-May / dev-August) graph history. **Verdict: fail — halt.**
The theory neither won nor lost; "survives the novelty" cannot be measured
on an archive in which novelty has not had time to wear off. Phases 2–6 do
not run.

Why the criterion is wrong *for now* (not softened, per the goal command):
the eval design assumes ≥ ~6 months of organically written evidence; the
meaning-graph writer went live 2026-05-25 and evidence arrives in bursts
tied to development, not capture rhythm.

Resume conditions, in order of preference:
1. **Wait and rerun** (no decisions needed): the harness is committed and
   free. CORRECTED 2026-08-09 (the first entry misdated this): the earliest
   cut is 2026-06-01, so the first uncensored 90 d window closes
   **2026-08-30** — the harness gets its first defined 90 d read as soon as
   evidence exists past that date. The Aug 1 cut's 28 d window closes
   2026-08-29. A CI-clean verdict still wants 2–3 more months of organic
   capture on top.

Post-halt diagnosis (2026-08-09, follow-up queries): the June evidence hole
is a **writer gap, not a capture gap** — founder signals by month are
May 15 / Jun 8 / Jul 0 / Aug 1, revisits May 53 / Jun 270 / Jul 43 /
Aug 223, and **6 of June's 8 signals were never cited by any evidence row**
(uncited: May 2, Jun 6). Only July is true capture silence. Backfilling the
6 missed June signals through the meaning-graph writer (evidence timestamps
backdated to signal capture time) would give the Jun 1 cut real positive
labels and make the 28 d AUC defined immediately.
2. **Founder may re-scope the criterion** (explicitly a criteria change,
   not made here): shorter horizons (7/14 d) with weekly cuts, and/or labels
   that count graded returns (588 revisit events exist) rather than only
   new-signal evidence. Either would make the question askable sooner at
   the cost of measuring something weaker than "survives the novelty."
3. Phase 0's module stays shipped, consumed by nothing, gated by its own
   35 tests — no risk parked in the tree.

### 2026-08-09 — FOUNDER OVERRIDE: surface swap authorized (criteria change, recorded)

The founder reviewed the live-archive diagnostic (both boards side by
side) and explicitly chose to replace the shipped ranking — "I hate what
I see today." Phase 5's blind-judgment gate is brought forward as the
governing criterion; the Phase 1 AUC gate stays recorded as failed and
the harness remains the long-horizon arbiter as the archive ages. This is
a founder criteria change, not a softened gate.

The diagnostic also found the real disease: **twin nodes**. The writer
inserted the judge's raw type into the (user, type, label) identity;
`normalizeContextNodeType` had every mapping and was never called at the
chokepoint. 12 founder nodes were 8 thoughts. Fixes shipped:
- writer canonicalizes type at `addSignal` (identity chokepoint) and
  clips labels on word boundaries via Intl.Segmenter (Korean labels were
  hard-sliced mid-word); leading-punctuation fragments rejected.
  Tests: `meaning-graph-writer-labels.test.ts` 4/4.
- `scripts/merge-twin-nodes.ts`: merged **10 twin groups across all
  users** (FKs discovered dynamically — caught two-modes'
  personal_memory_claims/evidence); 0 duplicate-label groups remain;
  2 garbled Korean labels rebuilt from their signals' own text.
- Post-merge founder board: **8 distinct pulls**, merged histories
  (top S 21.5 → 21.8 d).

Expedition decision for Phases 2–5: land **compute-at-read** node
dynamics (S/R/state/Importance replayed per request — milliseconds at
this scale) instead of Phase 2's columns, because a migration on this
dev-based branch risks journal conflict with two-modes' in-flight 0029+.
Columns become a follow-up in a quiet migration window; the math is
identical either way.

### 2026-08-09 — writer-gap backfill + criterion v2 run (both gates FAIL — halt stands)

Founder approved two unblocks: (a) backfill the writer gap, (b) add a
return-label criterion v2 beside v1.

**Backfill** (`scripts/backfill-missed-writer.ts`): 8 uncited founder
signals (2 late-May, 6 June — packets existed, writer never ran) processed
through the production `persistMeaningGraphForInspiration`; 8 judge calls,
exactly the pre-stated estimate. New citations backdated to capture time;
touched nodes' first/last-seen recomputed from evidence. All 34
repaired-signal evidence rows verified dated at capture; 0 uncited signals
remain. Post-repair archive: 131 evidence rows, 25 nodes, by month
**May 71 / Jun 24 / Jul 0 (true capture silence) / Aug 36**. Disclosure:
the self-healing pass also normalized ~4–5 rows the live app wrote on
2026-08-09 against pre-August signals (same rule: citation re-dated to its
signal's capture time); nothing deleted.

**Harness run** (both criteria, founder archive, seed 42, zero model calls):

criterion v1 — evidence labels, monthly cuts, gate horizons 28/90 d:

| horizon | pairs | pos | recency | currentWeight | movementScore | meanSignalImp | S | E[R] |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 28 d | 21 | 5 (23.8%) | **1.0000** | 0.2000 | 0.5625 | 0.7375 | 0.3125 | 0.8000 |
| 90 d | 0 | — | n/a | n/a | n/a | n/a | n/a | n/a |

ΔAUC (champion ER28): vs currentWeight **+0.600 [+0.18, +0.90]** (wins);
vs recency **−0.201 [−0.41, −0.02]** (loses, CI fully negative).
**v1 verdict: fail** — the null wins the only askable horizon; 90 d
remains unobservable until data exists past 2026-08-30.

criterion v2 — return labels (graded revisit on a signal cited ≤ T),
weekly cuts, horizons 7/14 d, censored by last activity:

| horizon | pairs | pos | recency | currentWeight | movementScore | meanSignalImp | S | E[R] |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7 d | 109 | 63 (57.8%) | 0.6453 | 0.5390 | 0.6042 | 0.5129 | 0.4268 | 0.6139 |
| 14 d | 98 | 74 (75.5%) | 0.6351 | 0.6312 | 0.6363 | 0.4476 | 0.3136 | 0.4296 |

ΔAUC (champion ER7): vs recency −0.032 [−0.146, +0.083]; vs currentWeight
+0.074 [−0.060, +0.216] — both straddle zero ⇒ **marginal ⇒ fail** per the
goal command. At 14 d the champion loses outright: ER14 − recency
−0.202 [−0.339, −0.061]; ER14 − currentWeight −0.199 [−0.339, −0.063].
**v2 verdict: fail.**

Reading, without softening: on this archive the new state does not beat
the baselines anywhere it can be measured. Two structural notes recorded
for the eventual re-run, not as excuses: (1) S *anti-correlates* with
short-horizon returns (0.31–0.43) — newly-hot nodes have low proven
stability and high revisit traffic, consistent with S and activation
being different axes; v2's week-scale question is recency's home turf and
was flagged as weaker when approved. (2) On an 11-week archive every
node's demonstrated survival horizon is weeks — saturation gives S almost
no dynamic range by design. The question S exists to answer ("next month
and quarter", per The decision that matters) still has no data old enough
to ask it. The goal stays halted; the harness reruns free as the archive
ages — first 90 d read after 2026-08-30, meaningful spread in S wants
fall/winter.

### 2026-08-12 — re-landed on current dev (integration, no behavior change)

Both this goal and `capture-feeds-the-graph` were authored on a 2026-06-22
base (f1feda0) and sat unpushed while two-modes merged 182 commits into
`dev` (PR #225). Re-landed by cherry-pick onto current dev as
`goal/capture-feeds-the-graph-r2` and `goal/durable-interest-r2`.

What the integration actually cost, recorded so the next re-land is cheaper:

- **Conflicts were fewer than feared and all both-sides-additive.** The save
  path now carries three enqueues side by side (classification → graph write
  → group-reading refresh); dev's group-reading machinery is untouched.
- **Two of this work's changes were superseded by dev and dev's version was
  taken:** the drain cron is already `enabled: true` on all stages with a
  14-minute timeout and limit 25 (broader than the dev-stage-only fix), and
  the drain scheduler grew a delay mechanism this code now cooperates with.
- **Two test stubs needed teaching about dev's new fanout** — classification
  now triggers group-reading enqueues, so the stub db needed a thenable
  select-chain. Scoped commits, no production change.
- **`top-of-mind-refresh.ts` was restructured under two-modes**: the evidence
  query was split out of its `Promise.all` and a new pre-probe step
  (`rankTopOfMindRefreshCandidates`) computes idempotency keys before the
  model call. Dev's version was taken wholesale and the pool-ordering
  insertion re-applied on top; the probe now consumes `orderedNodes` too, so
  the existing-note probe and the model's candidate set cannot diverge.
- **Integration note for the migration window:** dev added
  `group_reading_refresh` as a third `background_job_type` enum value via
  migration — confirming the same window can carry this goal's
  `write_meaning_graph` enum value and the `stability` columns.

Verification after re-land: `tsc --noEmit` clean, **495/495 unit tests pass**
(the pre-existing `admin-meaning-graph.test.ts` failure recorded on
2026-08-09 is fixed on current dev). Nothing pushed — the founder's
no-ship directive stands.

### 2026-08-12 — pre-PR review: the surface swap is withdrawn

A code review before opening the PR found that **the Phase 2–5 ranking swap
never took effect**, and two defects in the repair scripts.

**The swap was a no-op.** `top-of-mind-refresh.ts` and `top-of-mind-preview.ts`
were ordering their node pool by `E[R] × lifecycle state` — and then handing
that pool to `rankTopOfMindRefreshCandidates` / `rankTopOfMindPreview`, both of
which immediately re-sort by their own score (`score → evidenceCount → weight`,
and `nodeScore` respectively) and slice. The injected order survived only as a
stable-sort tiebreaker on an exact three-way tie, i.e. never — while costing a
full-archive `loadNodeDynamics` replay on paths that run after *every*
classification and on *every* preview request.

**It is withdrawn rather than repaired**, and the goal returns to halted:

1. The Phase 1 prediction gate failed — recency beat `E[R]` at the only
   measurable horizon. The swap survived only on a founder override.
2. That override's premise turns out to have been the wrong target. The board
   the founder rejected was bad because of **twin nodes** — 12 nodes that were
   8 thoughts, each doubled — which the same session fixed. Re-measuring after
   the merge, the new lens returned *the same top five items in a different
   order*, with every node `emerging` at S 8–22 days. On an eleven-week
   archive there are no survived gaps to rank by.
3. Repairing it would therefore ship a behavior change to the surface the
   founder looks at most, on code that has provably never executed its
   intended path, for a reordering worth approximately nothing today.

`stability.ts` and `node-dynamics.ts` stay — pure, tested, consumed by
nothing. That is what a halted goal should look like, and re-wiring is ten
lines whenever the harness can finally measure whether it helps (first
uncensored 90-day read after 2026-08-30; meaningful S spread wants winter).

**Two script defects, both fixed.** `backfill-missed-writer.ts` was
backdating *every* evidence row a run produced — including rows citing the
judge's comparison candidates, which belong to differently-dated saves — so
the repair was inventing the provenance it claimed to restore; it now
backdates only rows citing the trigger signal. Its "self-healing" pass was
removed outright: the predicate was a date window rather than an identity, so
with a live capture-path writer it would re-date correct evidence and
silently falsify the input to the entire scoring model.

`shortText`'s fallback fired whenever a word-boundary clip landed at ≤ 40 code
points — a threshold inherited from the old ASCII-space heuristic — discarding
a good clip and hard-cutting mid-word, which is the bug the function was
written to fix. It now falls back only when the boundary clip is empty.
