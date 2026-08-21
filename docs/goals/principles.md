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
| `PRINCIPLE_LIMIT` | 7 | Held + aspirational principles a profile may surface — a list longer than a person can hold isn't principles |

The existing decay arithmetic already cooperates: support and spread
never decay, so long-evidenced dormant patterns floor instead of
vanishing — durable character is precisely the residue the selection
math refuses to forget.

**States — the honesty marks:**

| State | Meaning | How |
|---|---|---|
| `held` | Demonstrated by history | Minted by synthesis only when the longevity bar is met |
| `aspirational` | Declared by the owner, not yet demonstrated | `POST /api/principles`; locks on creation; visibly marked |
| `contested` | Standing principle with live contrary judgment | v1: the owner's own `not_true` feedback. Automatic contradiction detection is **deferred** (v2) — it needs a judge comparing new signals against standing principles, and real usage should prove the need first |

An `aspirational` principle becomes `held` when synthesis attaches
citing signals to it that meet the bar — the declaration was a promise;
the evidence redeems it. Contested principles remain visible; hiding a
disputed principle would make the list unarguable.

**Decidability = rank.** Principles carry an explicit integer rank.
Synthesis proposes an order; the owner may reorder, and an owner reorder
is sticky — synthesis thereafter appends new principles at the bottom
and never re-sorts what the owner arranged. No cleverness: the rank *is*
the tie-breaker, which is what makes it decidable.

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

Provider: one call, `synthesizePrinciples` — whole-set output like
top-of-mind synthesis (≤ `PRINCIPLE_LIMIT`), temp 0, schema-constrained,
statements ≤ 200 chars, citations validated against held signals in
code, locked statements byte-identical from storage.

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

Eligibility arithmetic (`selectPrincipleEvidence`: signals meeting the
constants, with span and top-of-mind-appearance counts computed from the
version chain), the `synthesizePrinciples` provider call with the
phrasing contract, code-side validation (citations resolve, locked
byte-identical, shape checks), aspirational attachment, contested via
feedback, reconciliation on evidence loss, job wiring into the chain.

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
reorder controls, edit-in-place that locks. i18n in both catalogs
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
