# Goal: principles — the layer that survives

Status: **draft v1 — awaiting owner review (2026-08-18).** No code
exists. Phase 0's gate is owner sign-off on the canon amendment; nothing
is built before that.

Canon: extends `docs/data-model.md` with a **fourth layer**. Phase 0
amends that document; every later phase implements it and has no model
opinions of its own. If a phase discovers the canon can't express
something the product needs, the phase halts and the canon is amended
first — the code never wins an argument with the document.

Follows: the three-layer rebuild (`docs/goals/three-layers.md`, done
2026-08-15) and the generation canon (`docs/generation.md`,
drift-locked). Everything here rides the machinery those built: the
push-woken queue, match-or-mint, the decay arithmetic, the consent-bound
profile sessions.

## Why

WAKA currently answers "what is this person into *right now*" — top of
mind, deliberately decaying. It cannot yet answer the slower question an
agent actually needs before acting on someone's behalf: **"how does this
person choose?"** The owner's framing, recorded here as the concept's
definition:

- A **rule** binds a context: "don't spend more than $100 on LLM
  testing." It has parameters and a scope; strip the context and it
  stops meaning anything. It is *checkable*.
- A **principle** survives having its context stripped: "get something
  working before you put more money in." The same principle, dropped
  into different contexts, *compiles into different rules* — the $100
  cap is what frugality compiles to under "LLM testing."

Principles are the generator; rules are downstream instantiations. WAKA
stores the generator and treats the instantiations as evidence.

Four decisions, made by the owner on 2026-08-18, are load-bearing:

1. **Rules are evidence, never artifacts.** A captured rule enters as an
   inspiration, supports signals, and thereby supports principles. WAKA
   holds no rules registry — rules keep living where they act (project
   files, budgets, CLAUDE.md).
2. **Demonstrated, declarable with honesty marks.** Principles are
   derived from longitudinal evidence. The owner may also declare one
   outright; a declaration locks (their words are never rewritten) but
   is visibly `aspirational` until history demonstrates it. WAKA starts
   by trusting your word and, over time, replaces trust with
   demonstration.
3. **One artifact class.** Values ("frugal mindset"), maxims ("working
   before spending"), and stances share one class — `principles` — with
   a `type` field. One vocabulary word, per the canon discipline.
4. **"Deterministic" means auditable + decidable + bounding — not an
   oracle.** Every answer can cite the principles it leaned on
   (auditable, the way entries cite signals); principles carry an
   explicit rank so conflicts break the same way every time (decidable);
   and they constrain the option space rather than pick answers
   (bounding). Reproducible same-answer output was considered and
   **rejected**: the agent reasons freely inside the fence.

Two structural decisions follow from the architecture:

- **Per-profile.** A human profile earns its principles; an agent
  profile earns its own. Same ownership rule as every other layer. When
  an agent acts *for* its human, the human's principles bound the work
  and the agent's own bound only its conduct — consumption guidance
  enforced in skills, not in the schema.
- **A separate surface view.** Principles join wall / capture / archive
  / signals as a first-class state of the one surface — not a profile
  sub-tab.
- **Many, not one (owner clarification, 2026-08-18).** Top of mind is
  ONE bounded artifact, rewritten whole. Principles are a **growing
  set** — a person is as deep as their history, and the set grows with
  it. Architecturally this makes principles *signals-shaped* (per-item
  minting into an open set), not top-of-mind-shaped (whole-artifact
  synthesis). Cardinality is the cleanest structural difference between
  the two layers, and the first thing the surface should communicate.

## The layer, precisely

**Derivation base.** Principles cite **signals** (M:N, like top-of-mind
entries) — the evidence-backed, shareable unit. Generation *reads* the
whole stack: signals with their evidence spans, and the top-of-mind
version chain as corroboration of longevity. Inspirations participate
transitively through the signals they evidence. The audit chain is
answer → principle → signals → the person's own captures, unbroken.

**Selection by longevity — the mirror of top of mind.** Top of mind
asks what currently matters and decays on purpose. A principle is what
*survives*. Eligibility for synthesis (proposed constants; named exports
when implemented, drift-locked then, tuned only with real data):

| Constant | Proposed | Meaning |
|---|---|---|
| `PRINCIPLE_MIN_SIGNALS` | 3 | Distinct citing signals required |
| `PRINCIPLE_MIN_SPAN_DAYS` | 45 | First-to-last evidence span across those signals |
| `PRINCIPLE_MIN_TOM_APPEARANCES` | 5 | Distinct top-of-mind versions in which the citing signals were selected |

**There is no cap on the set — by design**, the same answer the canon
gives for signals. Growth is bounded behaviorally: a principle is
expensive to earn (the bar above), and the merge evaluation collapses
overlap instead of letting near-duplicates accumulate. A memory that
refused to learn a person's twentieth principle would be lying about
them. Consumption surfaces (the view, the MCP tool) present the set
ranked and may page it; storage never truncates it.

The existing decay arithmetic already cooperates: support and spread
never decay, so long-evidenced dormant patterns floor instead of
vanishing — durable character is precisely the residue the selection
math refuses to forget.

**States — the honesty marks:**

| State | Meaning | How |
|---|---|---|
| `held` | Demonstrated by history | Minted by synthesis only when the longevity bar is met |
| `aspirational` | Declared by the owner, not yet demonstrated | `POST /api/principles`; locks on creation; visibly marked |
| `contested` | Standing principle in live dispute | Two routes in v1: the owner's own `not_true` feedback, and the **conflict evaluation** — a judge finding two principles in genuine collision marks the pair contested for owner adjudication. (Behavior-vs-principle contradiction — new *signals* undermining a held principle — stays deferred to v2.) |

An `aspirational` principle becomes `held` when synthesis attaches
citing signals to it that meet the bar — the declaration was a promise;
the evidence redeems it. Contested principles remain visible; hiding a
disputed principle would make the list unarguable.

**Decidability = rank.** Principles carry an explicit integer rank.
Synthesis proposes an order; the owner may reorder, and an owner reorder
is sticky — synthesis thereafter appends new principles at the bottom
and never re-sorts what the owner arranged. No cleverness: the rank *is*
the tie-breaker, which is what makes it decidable.

**Generation is mint-or-match, not whole-set synthesis.** When a
cluster of signals crosses the longevity bar, a candidate principle is
distilled and compared against the existing set — the same recoverable-
mistake machinery the signal layer uses, one level up:

- **Overlap** → merge evaluation: embedding similarity, then a judge
  asking "same principle?" Same → the candidate's citations attach to
  the existing principle; no near-duplicate is minted.
- **Contradiction** → conflict evaluation: a judge finds the candidate
  (or two standing principles) in genuine collision. Both are marked
  `contested` **as a pair** and surfaced for the owner to adjudicate —
  merge, retire one, or simply rank them. Rank keeps the fence
  *decidable while contested*: the higher-ranked principle wins
  operationally, so a contradiction is a visible tension awaiting
  judgment, never a broken system.
- **Novel** → minted `held` with its citations. A candidate matching an
  `aspirational` declaration redeems that declaration to `held` instead
  of minting beside it.

**The phrasing contract.** Every principle is phrased as a direction or
constraint — "prefer X over Y," "before X, require Y" — never as an
answer, never as a summary. Enforced in the synthesis instruction,
validated in code (shape checks; violators dropped), and locked
statements are copied byte-identical from storage exactly as top-of-mind
entries are: the model is asked to reproduce them and then not trusted
to have done so.

**Lifecycle honesty.** Statements minted by synthesis may be refined by
later synthesis while unlocked; an owner edit locks. Deleting a signal
that a principle cites triggers reconciliation: a `held` principle that
falls below the bar reverts to `aspirational` if owner-declared, or is
retired if machine-minted. (Same cascade discipline as
signals-after-evidence-loss.)

## When a principle is generated

Asked by the owner on 2026-08-18. Two different "whens":

**The evaluation runs constantly** — chained one link onto the existing
pipeline. Any top-of-mind refresh that versioned *with changes* enqueues
`refresh_principles` (push-woken, debounced per profile), so the check
runs seconds after the capture that started the chain. Feedback on a
principle and a manual refresh also trigger it; the daily sweep remains
a safety net, never the mechanism.

**A principle mints only at a bar-crossing.** Nearly every run is one
cheap SQL question — did any signal cluster newly cross the longevity
bar? — answered no, exiting with zero model calls, exactly as a capture
that yields nothing costs no synthesis today. The expensive path
(distill → judge → mint/attach/conflict) runs only in the rare moment a
theme's third distinct signal lands with a 45-day span and five
top-of-mind survivals behind it. Chaining rather than scheduling means
that moment surfaces seconds after the capture that completed the case
— the day history earns a principle is worth catching live.

**Declarations are not generation.** An aspirational principle is
created instantly by the owner's own hand; generation's later role is
redemption — a distilled candidate matching the declaration flips it to
`held` instead of minting beside it.

**Lived timeline for a fresh profile:** signals in seconds, top of mind
in seconds, **no held principle for ~six weeks** regardless of capture
volume — `PRINCIPLE_MIN_SPAN_DAYS` is a wall clock, not a volume bar.
Aspirational declarations may fill the view from day one; the first
earned principle arrives when history, not enthusiasm, has accumulated.

## One question per view

Raised by the owner on 2026-08-18: does a fourth view multiply the
places a person sees "the same content"? The audit, and the rules that
keep the answer no:

**An inspiration is primary in exactly one view — the archive.** In
every other view it appears only as provenance behind an expansion
(signal → evidence, entry → citations, principle → citing signals).
Tracing is the auditability the owner chose, not duplication; it stays
folded until asked for. Each view answers one question no other view
answers: archive — *what did I save?*; signals — *what do my saves keep
saying?*; wall — *what matters now?*; principles — *how do I choose,
always?*

**The real convergence risk is top of mind vs principles**, not
inspiration sprawl: both are short lists of statement-shaped lines
citing signals, and "You keep choosing small tools" (entry) versus
"Prefer small tools you can hold in your head" (principle) are nearly
the same sentence two views apart. Four rules keep them distinct — the first structural, three presentational:

0. **Cardinality.** Top of mind is one bounded artifact; principles are
   an unbounded growing set. The surface says so: the wall is a single
   rewritten board, the principles view is an accumulating ranked list.
1. **Form.** Top of mind stays descriptive and second-person; principles
   are imperative constraints. The phrasing contract doubles as the
   anti-convergence rule, and synthesis receives the current entries
   with the instruction that a principle may not restate one — it must
   be the generalization that outlives the current moment. (Instruction-
   level in v1; a cosine-overlap validator is v2 if usage shows the
   instruction leaking.)
2. **Material.** The wall is living paper — tilt, churn, decay.
   Principles render austere: a short numbered list, no tilt, each row
   carrying *held since* and its evidence span. Today's desk versus the
   engraved list.
3. **Progressive disclosure.** The `principles` nav affordance appears
   only once the profile holds at least one principle (declared or
   earned); the view stays reachable by URL. A new profile sees exactly
   today's surface — the fourth question shows up when there is an
   answer to it, which the 45-day bar makes honest anyway.

## Shape of the work

Schema: `principles` (id, profile_id, statement, type
`value|maxim|stance`, state `aspirational|held|contested`, rank,
locked_at, created_at, updated_at; composite `(profile_id, id)` tenancy
FKs per house pattern) and `principle_signals` (principle_id, signal_id,
profile_id, reason). `feedback.target_type` gains `'principle'`.
Additive migration — no wipe, no backfill needed (production holds one
capture).

Pipeline: a `refresh_principles` job, keyed per profile, debounced by
partial unique index, enqueued when a top-of-mind refresh completes with
changes (the chain becomes derive → top of mind → principles), on
principle feedback, and manually. Push-woken like everything else; the
daily sweep remains only a safety net.

Provider: two calls, both temp 0 and schema-constrained.
`distillPrinciple` reads one eligible signal cluster (plus current
top-of-mind entries for the no-restatement rule) and returns one
candidate ≤ 200 chars. `judgePrincipleRelation` compares a candidate
against one existing principle and answers `same | independent |
conflicting` — the merge and conflict evaluations in a single judged
call, conservative toward `independent` (a duplicate is visible and
mergeable; a wrong merge or a false conflict is not). Citations are
validated in code; locked statements never round-trip through a model.

## Phases

### Phase 0 — Canon amendment

`docs/data-model.md` gains the fourth layer: vocabulary (principle,
rule-as-evidence, the three states, rank), the access-matrix rows
(owner: full; agent session on its human's principles: **read only** —
capture doesn't extend here because principles are curation, not
capture), and the sharing stance (principles are **not shareable** in
v1; the group wall stays signals-only). `docs/generation.md` is *not*
touched yet — its drift test would fail on constants that don't exist,
which is the lock working; it updates in the same diff as the code
(Phase 6).

**Gate: the owner signs the amended canon. Nothing below starts first.**

### Phase 1 — Schema

Tables + enum extension + additive migration, applied to local and
scratch; `drizzle-kit check` clean; tenancy FKs follow the composite
pattern; unit tests for the table contracts.

**Gate:** migration applies cleanly twice (idempotent re-run refused
gracefully); typecheck + suite green.

### Phase 2 — Longevity selection and synthesis

Eligibility arithmetic (`selectPrincipleEvidence`: signal clusters
meeting the constants, with span and top-of-mind-appearance counts
computed from the version chain), `distillPrinciple` with the phrasing
contract **and the no-restatement rule** (current top-of-mind entries
ride along as what a principle must generalize beyond, never echo),
mint-or-match against the existing set via embeddings +
`judgePrincipleRelation` (same → attach; conflicting → contested pair;
independent → mint), aspirational redemption, contested via feedback,
code-side validation (citations resolve, locked byte-identical, shape
checks), reconciliation on evidence loss, job wiring into the chain.

**Gate:** unit tests pin the arithmetic (eligibility bars, rank
stickiness, aspirational→held promotion, reconciliation both
directions); a live one-call sanity check against the real model (like
`verify-merge-judge`) shows the phrasing contract holds; full suite
green.

### Phase 3 — API

`GET /api/principles` (ranked; `?profile=` under the matrix),
`POST` (declare → aspirational + locked), `PATCH /:id` (edit → lock),
`DELETE /:id`, `POST /reorder` (owner; sticky), `POST /refresh` (202,
debounced), feedback accepts `targetType: "principle"`. Cross-account
answers 404 exactly like signals (no existence oracle).

**Gate:** route tests cover the matrix cells (owner / agent-on-own /
agent-on-human read-only / cross-account 404) and the reorder
stickiness; suite green.

### Phase 4 — The view

`principles` becomes a surface state alongside wall / capture / archive
/ signals: ranked list with state chips (`held` / `aspirational` /
`contested`), expandable citations (principle → signals), a declare box,
reorder controls, edit-in-place that locks. Rendered austere per the
one-question-per-view rules: numbered, untilted, each row carrying
*held since* and its evidence span — deliberately not the wall's paper.
**Progressive disclosure:** the nav affordance appears only when the
profile holds ≥1 principle; the view stays reachable by URL, where the
empty state is one sentence and the declare box. i18n in both catalogs
(en-US, ko-KR — "원칙").

**Gate:** web tests green; browser verification against a live stack —
declare, reorder, edit-lock, contested rendering all exercised, not
assumed.

### Phase 5 — MCP

`waka_get_principles` (ranked, with states and citations). Skill
guidance gets the consumption contract: principles are consulted before
acting; when acting for the human, the human's principles bound the
work; answers should cite principle ids. waka-mcp README + live suite
extension (declared aspirational visible through the tool).

**Gate:** waka-mcp unit + live suites green against a stack running the
new API.

### Phase 6 — Canon sync and drift lock

`docs/generation.md` gains the principles section and constants tables
**in the same diff** as the exported constants; `generation-doc.test.ts`
extends: constants pinned both directions, `[checked]` pins for the
eligibility function and the phrasing validator, path integrity.
`docs/data-model.md` reconciled with anything the phases amended.

**Gate:** the drift test passes with the new constants; full suites
green in both repos.

### Phase 7 — E2E and cutover

`tools/e2e/principles.ts`: declared-aspirational path live end to end;
promotion path with the documented env overrides for the time-span bars
(`WAKA_PRINCIPLE_*_OVERRIDE`, honored only when set — e2e cannot wait 45
days; unit tests pin the real arithmetic). Deploy to dev on merge,
behavioral verification on dev.waka.im, then promote to production.

**Gate:** e2e green locally and against deployed dev; prod deploy green;
a principle declared on waka.im is visible through web and MCP.

## Out of scope (v1, deliberately)

- **Group principles** — the wall stays signals-only.
- **Automatic contradiction detection** — contested is owner-judgment
  only until usage proves the judge is needed.
- **A principle version chain** — rows carry lifecycle; a history view
  can come later. (Locks make silent rewrites impossible meanwhile.)
- **Reproducible answering / WAKA-as-oracle** — explicitly rejected;
  WAKA serves the fence, agents reason inside it.
- **Cross-profile precedence enforcement** — the human-outranks-agent
  rule lives in skill guidance, not the schema, until there's evidence
  it needs teeth.

## Log

(empty — awaiting Phase 0)
