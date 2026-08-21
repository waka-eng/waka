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

## What qualifies, and what cannot

Five tests. A candidate — minted or declared — is a principle only if
**all** applicable tests hold:

1. **The context test.** It still instructs after every proper noun,
   number, and project name is deleted. "≤$100 for LLM testing" dies
   (those are parameters — a rule); "have something working before you
   spend more" survives.
2. **The directive test.** It prescribes the next choice; it never
   describes the person. "You keep choosing small tools" is a fact —
   that is a *signal*. Its principle form is "prefer tools you can hold
   in your head."
3. **The evidence test.** It cites at least `PRINCIPLE_MIN_SIGNALS`
   distinct signals from this profile's own history. Uncited wisdom —
   "be kind," "move fast" — is a horoscope regardless of truth.
4. **The time test.** Its evidence spans `PRINCIPLE_MIN_SPAN_DAYS` and
   survived `PRINCIPLE_MIN_TOM_APPEARANCES` top-of-mind versions. A
   two-week obsession is top of mind, not character.
5. **The completion test.** It can never be finished or satisfied.
   "Ship by June" completes — a goal, not a principle. "Working before
   scaling spend" never completes.

What cannot be a principle, each mapped to where it belongs instead: a
**rule** (context-bound, parameterized) → evidence; a **fact** about the
person → signal; **what currently matters** → top of mind; a **goal**
(completable) → not WAKA's to hold; a **single-burst enthusiasm** →
fails time, stays a signal; **generic virtue without citations** →
refused outright.

**Declarations get a graded exemption.** An aspirational declaration
skips evidence and time at creation — trusting the owner's word pending
demonstration is the point — but must pass context, directive, and
completion. A declaration that is really a rule or a goal is refused at
`POST` with the failing test named, teaching the concept at the exact
moment of confusion. (One judged call, `validateDeclaration`;
owner-initiated, outside the daily cadence.)

## When a principle is generated

Owner decision (2026-08-18, superseding the chained design drafted
earlier the same day): **generation runs once per day, at midnight, and
nothing else may trigger it.** The reasoning is the layer's own tempo: a
principle is what a person lives by, shown through many inspirations and
signals over months — one or two captures never make one, so there is no
moment to catch live, and a daily rhythm is the honest cadence.

**Mechanism.** A dedicated `sst.aws.Cron("PrincipleRefresh")` at
`PRINCIPLE_REFRESH_CRON` — **00:00 PST** (owner decision 2026-08-18;
fixed 08:00 UTC, so during daylight saving it fires at 01:00 Pacific —
EventBridge crons don't shift with DST; per-profile timezones deferred). It enqueues `refresh_principles` for
each profile with signal or top-of-mind activity since the last run,
then wakes the worker — the queue stays the mechanism; the cron is the
sole enqueuer.

**The hard guarantee, drift-locked.** No code path outside the cron
handler (and an env-gated e2e override, absent in deployed stages)
enqueues `refresh_principles`. A generation-doc test pin greps for call
sites and fails CI if another appears. The manual refresh endpoint from
the earlier draft is **deleted**; deployed surfaces expose no trigger.
E2e invokes the job directly under the override because it cannot wait
for midnight; unit tests pin the real arithmetic.

**What stays immediate — flagged for owner veto: state maintenance
involves no generation and does not wait for midnight.** `not_true`
feedback flips a principle to `contested` at feedback time; deleting
evidence under a held principle reconciles it (held → aspirational if
declared, retired if minted) at delete time. Both are cheap SQL state
flips with zero model calls. Waiting a day to stop displaying something
the owner already refuted would be dishonesty, not thrift. Generation —
distilling, judging, minting, redemption — happens only at midnight.

**Declarations are not generation.** An aspirational principle is
created instantly by the owner's own hand (validated at POST, see the
qualification tests); the daily run's later role is redemption.

**Lived timeline for a fresh profile:** signals in seconds, top of mind
in seconds, and the first held principle at the first midnight after the
bar is crossed — about six weeks in, regardless of capture volume.
`PRINCIPLE_MIN_SPAN_DAYS` is a wall clock, not a volume bar.

## The machine rendering

Owner decision (2026-08-18): the primary consumer of principles is
**other AI tools**, deciding on the person's behalf without the person
in the loop. So the canonical rendering is not the web view — it is a
**single deterministic markdown document**, produced by one renderer and
served byte-identically to every consumer. The web view is the human's
decorated reading of the same document; if two agents could fetch two
shapes, they could act under two readings of one person.

Contract properties, each testable:

- **Deterministic.** Same principle set → byte-identical markdown
  (rank order, fixed date format, stable ids). Pinned by a golden test
  — a fixture set rendered and compared byte-for-byte, so the format
  itself is drift-locked like everything else.
- **Self-describing.** The preamble IS the consumption contract:
  bounding-not-answering, rank-decides-conflicts, cite-ids-in-decisions,
  and the state semantics. An AI fetching it cold needs no other
  documentation.
- **Citable.** Each principle carries a stable short id
  (`p-<uuid8>`), so a decision made without the person present can be
  audited afterward — the answer → principle → signals → captures chain
  extended to its last mile.
- **Tension is explicit.** Contested pairs name each other inline and
  the preamble says rank decides meanwhile — an agent never stalls on an
  unresolved conflict.
- **Aspirational is binding for agents** (flagged for owner veto): a
  declaration is the person's own stated word, and an agent acting for
  them obeys it even before history demonstrates it. Demonstration
  governs what WAKA asserts; the person's word governs what their
  agents obey. The preamble states this.

Delivery: `GET /api/principles.md` under any WAKA credential (works for
any tool that can hold a token and fetch — not only MCP speakers), the
same access matrix as the JSON list; `waka_get_principles` returns the
identical document (with the structured list available for tools that
want fields). One renderer, no second shape.

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
partial unique index, enqueued **only** by the daily
`PrincipleRefresh` cron (00:00 PST) for profiles with activity
since the last run — see "When a principle is generated" for the hard
guarantee. Feedback and evidence-loss are immediate SQL state flips
outside generation.

Provider: three calls, all temp 0 and schema-constrained.
`validateDeclaration` applies the context/directive/completion tests to
an owner declaration and names the failing test on refusal.
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
v1; the group wall stays signals-only). `docs/generation.md` already
carries the design as a clearly-marked **"designed, not yet
implemented"** section (added at the owner's request, 2026-08-18, so one
doc is the source of truth for generation mechanics); its constants stay
in prose there because the drift test would rightly fail on table rows
naming unexported constants. Phase 6 graduates that section into the
drift-locked tables in the same diff as the code.

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
`POST` (declare → `validateDeclaration` → aspirational + locked, or a
refusal naming the failing test), `PATCH /:id` (edit → lock),
`DELETE /:id`, `POST /reorder` (owner; sticky), feedback accepts
`targetType: "principle"`, and `GET /api/principles.md` — the canonical
machine rendering (see "The machine rendering"), with its golden
byte-for-byte test. **No refresh endpoint** — generation belongs to the
cron alone. Cross-account answers 404 exactly like signals (no
existence oracle).

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
(en-US, ko-KR — "원칙"). Visual spec of record until this phase lands:
the owner's mockup canvas (2026-08-18) —
https://claude.ai/code/artifact/dd9a3f29-8403-4ca7-9272-23e29d8feda5
(populated view, day-one empty state, refused declaration).

**Gate:** web tests green; browser verification against a live stack —
declare, reorder, edit-lock, contested rendering all exercised, not
assumed.

### Phase 5 — MCP

`waka_get_principles` returns the canonical markdown document — the
same bytes `GET /api/principles.md` serves — plus the structured list
for tools that want fields. Skill guidance gets the consumption
contract: principles are consulted before acting; when acting for the
human, the human's principles bound the work; answers cite principle
ids. waka-mcp README + live suite
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

`tools/e2e/principles.ts`: declared-aspirational path live end to end
(including a refused declaration naming its failing test); promotion
path with the documented env overrides for the time-span bars **and a
direct job invocation** (`WAKA_PRINCIPLE_*_OVERRIDE`, honored only when
set — e2e can wait for neither 45 days nor midnight; unit tests pin the
real arithmetic and a drift pin holds the cron-only guarantee). Deploy to dev on merge,
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
