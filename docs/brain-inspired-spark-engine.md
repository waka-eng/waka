# Brain-inspired spark engine — accumulation, firing, consolidation

> **Status**: S1 + S2 shipped (2026-07) as the *attention scheduler*
> variant — see §6. Math: `packages/api/src/scoring/activation.ts`.
> DB glue: `packages/api/src/lib/signal-activation.ts`. Wiring:
> `queue/classifier.ts` (capture spreading + immediate re-judge) and
> `routes/inspirations.ts` (revisit/reflection/edit pulses). Table:
> `signal_activations` (migration 0027). S3/S4 remain design.
>
> Builds on the shipped WOW pipeline
> ([`wow-moment-algorithm.md`](./wow-moment-algorithm.md)) and the OKF vault
> ([`okf-vault-protocol.md`](./okf-vault-protocol.md)). Nothing here changes
> the vault format; everything below the threshold lives in the DB index
> ("the unconscious"), and only fired sparks surface as documents.

## 1. The gap

Today a top-of-mind note can only be born at capture time: a new trigger
signal is compared pairwise against ≤50 candidates and judged immediately.
That finds *bridges between one strong pair*. It structurally cannot find
the thing the product promises: **ten individually weak signals that add up
to one big spark**. A signal that scores 0.3 against every neighbor never
fires, no matter how many neighbors accumulate.

The brain solves this with temporal summation: weak presynaptic inputs each
nudge a neuron's membrane potential; the potential decays (leaky), but if
inputs arrive densely enough it crosses threshold and fires — an output none
of the inputs could have produced alone. This document maps that mechanism
onto WAKA's existing machinery.

## 2. The mapping

| Neuroscience | WAKA (existing) | WAKA (this design) |
| --- | --- | --- |
| Presynaptic input | signal capture, revisit events | same events, now *charging* neighbors |
| Membrane potential | — | `activation` per indexed signal (DB only) |
| Leaky decay | `FreshnessDecay = 0.5^(age/30)` pattern | lazy exponential decay, half-life ~7d |
| Threshold crossing → fire | — | cluster potential ≥ θ → judge invoked |
| Action potential | top-of-mind note (pairwise only) | top-of-mind note from an *accumulated cluster* |
| Refractory period | judge `idempotency_key` | + per-cluster cooldown window |
| Prefrontal gating | LLM judge (bounded, contestable) | unchanged — arithmetic proposes, judge disposes |
| Sleep consolidation | meaning-graph writer (ad hoc) | scheduled consolidation job (episodic → semantic) |
| Long-term potentiation | node `weight`/`confidence` from evidence | recomputed during consolidation |

The vault principles are untouched: activation, potentials, and thresholds
are machine-derived and **never enter files**. A user only ever sees the
conclusion — a note that says *which* weak signals combined and *why*.

## 3. Activation model (index-side)

### 3.1 Charging

Each meaningful event injects charge into the *neighborhood* of the signal
it touches (neighbors = same bounded k-NN retrieval used today, ≤50, cosine
over stored embeddings — no new provider calls, no full-history scans):

```text
on capture(s):    for n in neighbors(s):  act(n) += w_capture * sim(s, n)
on revisit(s):    act(s) += w_revisit     (from existing inspiration_revisit_events)
on reflection(s): act(s) += w_reflect
on edit(s):       act(s) += w_edit
```

Starting weights (tunable, clamped so a single event stays sub-threshold —
that is the point): `w_capture = 0.30`, `w_reflect = 0.25`,
`w_revisit = 0.15`, `w_edit = 0.10`.

### 3.2 Leaky decay — lazily

Stored: `activation` + `activated_at`. Effective value is computed at read
time, exactly like `FreshnessDecay` avoids DB rewrites today:

```text
act_now = activation * 0.5^(daysSince(activated_at) / 7)
```

Writes fold decay in: `activation = act_now + charge; activated_at = now`.
No sweeper needed for correctness; consolidation (§5) prunes near-zero rows.

### 3.3 Centrality — personalized PageRank over the evidence graph

`centrality(i, N)` is not a heuristic. WAKA already has a reference graph:
signals are cited as evidence by top-of-mind notes (`related[]`), context
nodes (`evidence[]`), and edges (`evidence_signals`). A signal that many
judged documents lean on is structurally more important than one that
stands alone — the PageRank insight, applied to memories (adopted from
[zep-ia/brain](https://github.com/zep-ia/brain)):

```text
centrality = weightedPageRank(
  nodes  = indexed signals + notes + context nodes,
  edges  = evidence citations, weight *= e^(-λ · daysSince(cited_at)),
  damping = 0.85,
  personalization = current activation distribution   # ← the unification:
)                                                     #   biased PageRank from
                                                      #   active nodes IS
                                                      #   spreading activation
```

Edge-level temporal decay matters as much as node decay: without it, one
loud month three years ago dominates the graph forever. A graph whose edge
weights fade is a graph whose *current shape reflects the present self* —
the time-consciousness requirement, enforced in the arithmetic. Computed
during consolidation (§5), cached on the index, never in files.

### 3.4 Firing

After any charging event, evaluate the touched neighborhood:

```text
potential(N) = Σ_{i ∈ N} act_now(i) * centrality(i, N)
fire if: potential(N) ≥ θ
     and |{i ∈ N : act_now(i) > act_min}| ≥ 3     # ≥3 weak contributors —
                                                   # pairwise strength alone
                                                   # is the old pipeline's job
     and no note within the refractory window for cluster_key(N)
```

`cluster_key(N)` = hash of the sorted member ids above `act_min` — the same
idempotency discipline the judge already uses. On firing, the top members
(by `act_now * sim`) go to the **existing** bounded judge path
(`judgeWowMomentForInspiration` → `persistWowMomentForInspirationJudgment`)
with one addition to the prompt contract: the judge is told these signals
accumulated over time and asked whether they *compound* into one claim, not
whether any pair bridges. Accepted verdicts persist through the existing
idempotent helper and are born as vault documents, appearing in `log.md` as
**Spark** entries like every other note.

A spark born this way should carry `kind: recurrence` or a new
`kind: convergence` (several weak signals, no dominant trigger) so the UI
can say honestly: *"none of these mattered alone."*

## 4. Why the judge stays

A pure threshold model hallucinates meaning from coincidence (embedding
proximity ≠ significance). The LLM judge remains the gate, for the same
reason the vault carries evidence: the system's claim must be contestable.
Arithmetic (fast, cheap, always-on) nominates; judgment (slow, costly,
bounded) decides; only decisions become memory. That division — DB as
unconscious, vault as conscious — is already the architecture; this design
just gives the unconscious a working memory.

## 5. Consolidation — the sleep cycle

A scheduled background job (reusing `background_jobs`), per user, daily —
but **idle-gated**: the schedule proposes a window, and the job runs only
if the user has had no capture/revisit activity for several hours
(brain's boundary: heuristics may suggest consolidation, only an explicit
quiet phase authorizes it). The lexicon must never visibly reorganize
under the user's feet mid-session.

1. **Decay & prune** — drop activation rows below epsilon; cap neighborhood
   bookkeeping; apply edge-level decay and refresh cached PageRank (§3.3).
2. **Replay** — recompute context-node `weight`/`confidence` from evidence
   (already defined as a projection in `vault-architecture.md` — this gives
   it a heartbeat instead of ad-hoc updates).
3. **Emergence, budgeted** — clusters that fired repeatedly (≥2 sparks
   sharing members across ≥14 days) are proposed to the meaning-graph
   writer as context nodes; accepted ones are born as `context/nodes/*.md`
   and appear in `log.md` as **Emergence**. At most **K = 3 promotions per
   cycle** (brain's Top-K gate): the rest stay incubating until the next
   sleep. A mind holds few things on top — an unbudgeted backfill that
   births fifty nodes in one night would make the lexicon meaningless.
   This is episodic → semantic consolidation: the journal stays immutable,
   the lexicon grows slowly.
4. **Protention surface** — the top *unfired* rising cluster (potential in
   the top decile but below θ) seeds the next capture ritual's reflection
   question: "you keep circling X — what is it asking?" The system leans
   forward without claiming a connection it hasn't judged. Incubating
   clusters are never written to files.

## 6. Delivery slices

| Slice | Scope | Status |
| --- | --- | --- |
| **S1 — potential** | `signal_activations` table (migration 0027), charging on capture (neighbor spread) and revisit/reflection/edit (self pulses), lazy decay, adaptive cold-start threshold. | ✅ shipped |
| **S2 — firing** | Fire rule → the **existing** judge/persist path. Two firing routes: capture spreading re-judges the warmest old contributor immediately in the worker; self pulses re-enqueue the existing classification job (daily idempotency scope = refractory). No new job types, no new UI — convergence notes surface through the existing Top of Mind. `centrality = 1` until S3 caches PageRank. | ✅ shipped |
| **S3 — sleep** | Idle-gated consolidation job: decay/prune, edge decay + cached PageRank, weight replay, Top-K emergence proposals. | design |
| **S4 — protention** | Incubating-cluster reflection prompts; "almost sparked" internal telemetry. | design |

The shipped S2 is the *attention scheduler* formulation: activation never
judges and never persists — it only decides **when the existing pipeline
looks again**, with which trigger. The judge decides what it sees; the
idempotent persist path dedupes what is born. A new `kind: convergence`
(enum + judge-prompt change) is deferred until S3; until then the judge
labels accumulated clusters with the existing kinds.

Early-use ergonomics (the cold-start promise): with ~a dozen embedded
signals the adaptive threshold sits at its floor (0.48), so three related
weak signals captured across a first week — plus one reflection — are
enough for the system's first accumulated re-look, while the judge still
gates what becomes a note. Every knob lives in
`scoring/activation.ts` as a named constant with its rationale.

## 7. Prior art — what we take from zep-ia/brain, and what we refuse

[zep-ia/brain](https://github.com/zep-ia/brain) implements a four-stage
biological pipeline (working → short-term → hippocampus gate → long-term)
for agent runtimes. Adopted above: personalized weighted PageRank as the
importance model (§3.3), edge-level temporal decay (§3.3), idle-gated
consolidation (§5), the Top-K promotion budget (§5.3), and the secret gate
at the ingestion boundary (okf-vault-protocol §7).

Deliberately **not** adopted:

- **Working/short-term token buffers.** brain manages an agent's context
  window; WAKA manages a person's memory. There is no capacity pressure at
  capture — the episodic journal is append-only by design (ownership
  philosophy: nothing the user saved is ever discarded to make room).
- **Promotion as survival.** In brain, what isn't promoted eventually
  matters less; forgetting is a feature. In WAKA, importance affects
  *surfacing*, never *existence*. Files accumulate; only attention is
  scarce.
- **Tool-call co-reference edges.** WAKA's edges are semantic and
  LLM-judged with human-contestable evidence — a stronger substrate for
  meaning than call-graph adjacency.

## 8. Guardrails

- No scores/activations in files, ever (vault Principle 3).
- All retrievals bounded (≤50 neighbors) — no full-archive scans, same as
  today's pipeline.
- Every fired spark is idempotent and refractory-limited: accumulation must
  never become notification spam. Files accumulate; feeds flow. We are on
  the side of files.
