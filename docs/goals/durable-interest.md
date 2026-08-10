# Goal: what survives the novelty — storage strength for context nodes

Status: proposed 2026-08-10. Not started.
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
