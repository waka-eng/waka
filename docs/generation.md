# How WAKA generates memory

This is the mechanics companion to [data-model.md](data-model.md). That doc
says what the three layers *are*; this one says exactly how layer 2 is derived
from layer 1 and layer 3 from layer 2 — every threshold, every decision, and
which guarantees are enforced by code versus asked of the model.

**This doc cannot silently drift from the implementation.** Every constant in
the [tuning tables](#tuning-constants) is machine-checked against the exported
values in code by `packages/api/src/lib/generation-doc.test.ts`, which runs in
the normal unit suite. Change a value in code without updating this doc — or
here without updating code — and CI fails. The same test verifies every file
path this doc cites still exists, and re-asserts the structural claims marked
**[checked]** below. Prose can still lag in nuance; numbers and names cannot.

The pipeline in one picture:

```
  capture ──► enrichment ──► extraction ──► embed ──► match-or-mint ──► evidence
 (layer 1)   (links/images)  (model, ≤3)   (768d)    (attach/judge/mint)    │
                                                                            ▼
                                                              confidence + promotion
                                                              (emerging → active at 3)
                                                                            │
                            top of mind (layer 3) ◄── synthesis ◄── selection
                            one versioned artifact    (model, ≤7)   (score, ≤12)
```

Everything model-facing happens in exactly three calls per unit of work:
extraction (per capture), the merge judge (per ambiguous candidate, usually
zero), and synthesis (per refresh). Everything else — matching, confidence,
promotion, selection, versioning, locks — is deterministic code, testable
without a model.

---

## The life of one inspiration

The same pipeline, told as one capture's story. Say you save: *"Turned down
the platform-team offer. I keep choosing depth over breadth."*

1. **Capture.** The text lands as an inspiration — yours, editable, deletable,
   never shared. If it carried a link or an image, enrichment fetches the page
   body / describes the image in the background and re-derives when done.
2. **Extraction.** One model call reads the capture (plus reflections and
   enrichment) and proposes at most three candidate statements — here, likely
   one: "You keep choosing depth over breadth." Zero would also be a valid
   answer; a grocery list yields nothing.
3. **Match or mint.** The candidate is embedded and compared against your
   existing signals. If you have said this before in other words, the cosine
   is high and the capture **attaches as evidence** to that signal. In the
   ambiguous band the judge is asked once. Otherwise a new signal is born
   `emerging`.
4. **Recurrence decides.** At three pieces of evidence the signal promotes to
   `active`. One mention is a thought; three are a pattern.
5. **Confidence follows the evidence** — how much, how spread out, how
   recent, whether an agent corroborated it — computed fresh at every read,
   so a pattern you stop feeding fades without anyone touching it.
6. **Selection.** When the signal set changes, a refresh scores every
   eligible signal and takes the strongest twelve. New profiles borrow their
   best still-forming signals so the board is never blank.
7. **Synthesis.** One model call returns the whole artifact — at most seven
   entries, each citing the signals it rests on. Code then validates every
   citation, restores your locked entries byte-for-byte, and writes the next
   **version** of your top of mind. The old one is superseded, never erased.
8. **You push back.** Edit an entry (it locks), dismiss it, pin it, or mark
   it *not true* — and the next synthesis is told, with your correction
   outranking the model's phrasing. Delete the original inspiration and the
   whole chain unwinds: evidence gone, signal retired or marked unsupported,
   artifact re-synthesized.

Everything below specifies each step precisely.

---

## Layer 1 → Layer 2: how a signal is generated

### 1. What starts a derivation

| Event | Reason recorded | Where |
|---|---|---|
| A capture lands (`POST /api/inspirations`) | `created` | `packages/api/src/routes/inspirations.ts` |
| A capture's text or kind is edited | `edited` | same |
| A reflection is added or removed | `edited` | same |
| An attachment finishes enriching | `edited` (re-derive with new context) | `packages/api/src/lib/queue.ts` |

Deleting an inspiration does **not** start a derivation — it runs the reverse
operation, [reconciliation](#5-lifecycle), inside the delete transaction.

Derivation jobs are keyed per inspiration in the Postgres-backed queue
(`background_jobs`), so a burst of edits coalesces. An enqueue that lands
while a derivation is already **running** sets `rerun_requested` instead of
being absorbed: the running pass read its inputs before the new edit existed,
so on completion the job returns to `pending` and runs once more. The trailing
edit is never lost. **[checked]**

### 2. Enrichment: what the model gets to read

The extraction model sees more than the typed text when the capture carried
attachments, and everything it sees is bounded and provenance-labeled:

- **Links** — the page is fetched with per-hop SSRF checks (every redirect
  re-validated, private ranges refused unless the host is explicitly
  allowlisted via `WAKA_ENRICHMENT_ALLOWED_HOSTS`), under a hard timeout and a
  byte cap, and reduced to a text extraction of the page body.
- **Images** — described by a vision call (temperature 0) that transcribes any
  legible text verbatim and describes what is depicted; the description is
  capped and stored on the attachment.

Enrichment output is **derived context, never content**: it lives on the
attachment row, is clearly labeled machine-derived when shown, and is fenced
as untrusted data in every downstream prompt — a web page that says "ignore
your instructions" is a string, not an instruction.

### 3. Extraction: one model call per capture

`extractSignalCandidates` (interface in
`packages/api/src/lib/model-provider.ts`, Gemini implementation in
`packages/api/src/queue/gemini.ts`) reads one capture — text, the human's own
reflection answers, enrichment context — plus up to
`MATCH_CANDIDATE_SCAN_LIMIT` of the profile's existing statements *for
phrasing consistency only*. It returns **0 to `MAX_SIGNAL_CANDIDATES` (3)**
candidate statements, each with a reason and, when honest, a verbatim quote.

The contract, enforced by prompt and checked where code can check:

- **Zero is a right answer.** A grocery list is not evidence of a durable
  pattern. The prompt says so explicitly; a model that pads output mints
  noise, and noise is the failure mode this whole layer exists to prevent.
- **Statements are patterns, not summaries.** "You keep returning to X"
  rather than "this note is about X".
- **Quotes must be verbatim spans.** Absent is honest; invented is not.
- All user text is fenced between delimiters and the system instruction
  pins the model against instruction injection from capture content.
- Temperature 0, JSON schema-constrained output, statements clipped to 500
  chars in code regardless of what the model returns.

The model does **not** decide matching. It proposes statements; distance does
the rest.

### 4. Match-or-mint: where dedupe actually happens

Each candidate is embedded (`gemini-embedding-001`, 768 dimensions — same
model family as inspiration embeddings, see
`packages/api/src/lib/inspiration-embeddings.ts`) and compared by cosine
similarity against the profile's existing signal vectors — the
`MATCH_CANDIDATE_SCAN_LIMIT` (500) most recently evidenced, scanned in
application memory.

First, candidates within one batch are deduped against each other at
`SIGNAL_BATCH_DEDUPE_MIN_COSINE` (0.94) — a model that says the same thing
twice in one reply mints once.

Then, per candidate, the decision — this is `classifyMatch` in
`packages/api/src/lib/signal-derivation.ts` **[checked]**:

| Similarity to nearest existing signal | Decision |
|---|---|
| ≥ `SIGNAL_MATCH_MIN_COSINE` (0.86) | **Attach** — this capture becomes evidence of the existing signal |
| ≥ `SIGNAL_MERGE_JUDGE_MIN_COSINE` (0.7), < 0.86 | **Ask the judge** — one bounded model call: "do these two statements name the same durable pattern?" Yes → attach; no or any failure → mint |
| < 0.7, or no comparable vector | **Mint** — a new signal is born `emerging` |

The judge (`judgeSignalMatch`) is instructed that *uncertainty means
different*, and every malformed or failed response also lands on mint. The
asymmetry is deliberate: a wrong merge fuses two patterns invisibly and
corrupts both evidence trails; a wrong mint is a visible near-duplicate the
owner can merge or delete. When this system errs, it errs recoverably.

Attaching writes a row in `signal_evidence` (M:N: one capture can evidence
several signals, one signal accumulates many captures), unique per
(signal, inspiration) pair so re-derivation never double-counts.

### 5. Confidence, promotion, lifecycle

**Confidence** (0–100) is a pure function of the evidence set and the clock,
`computeSignalConfidence`:

```
confidence = SUPPORT × (evidence count, saturating at CONFIDENCE_SATURATION_EVIDENCE = 6)
           + SPREAD  × (time span of evidence, saturating at CONFIDENCE_SATURATION_SPREAD_DAYS = 30)
           + RECENCY × (decay with half-life CONFIDENCE_RECENCY_HALF_LIFE_DAYS = 45)
           + CONFIDENCE_SOURCE_DIVERSITY_BONUS (8) when evidence spans app AND agent capture
           , capped at 100
```

with weights `CONFIDENCE_SUPPORT_WEIGHT` (55), `CONFIDENCE_SPREAD_WEIGHT`
(30), `CONFIDENCE_RECENCY_WEIGHT` (15) — summing to 100 **[checked]**. The
diversity term is a *bonus*, not a weight, deliberately: most profiles are
app-only, and a weight would cap every solo human below 100 forever.
Corroboration adds; its absence must not subtract.

Because the formula contains a clock, *when* it runs is part of the contract:

- **Computed live at every personal read** — `GET /api/signals` (list and
  detail, so the web surface and MCP inherit it) and layer-3 selection both
  recompute confidence from the evidence rows at request time **[checked]**.
  This is what makes the recency term real: a signal that goes quiet fades on
  its own, with no write needed.
- **A snapshot is stored on the signal row**, written whenever evidence
  changes. It is written at the exact moment the recency term peaks, so it
  can only ever overstate a signal that has since gone quiet — which is why
  no personal surface serves it. It exists for two readers: as a coarse SQL
  pre-sort before live ranking, and as what the **group wall** shows. The
  wall's query is deliberately unable to reach `signal_evidence` or
  `inspirations` (a member must never touch another member's private layers),
  so it shows "confidence as the owner's system last wrote it" — the one
  documented staleness in the system.

**Promotion.** A signal is born `emerging` and becomes `active` at
`SIGNAL_PROMOTION_MIN_EVIDENCE` (3) pieces of evidence. Recurrence is the bar:
one mention is a thought, three are a pattern.

**Lifecycle** — status is a fact about support, computed, never guessed:

| State | Meaning | How it happens |
|---|---|---|
| `emerging` | Seen, not yet recurred | Minted; below 3 evidence |
| `active` | A durable pattern | Crossed 3 evidence |
| `retired` | Support fell away | Evidence deleted down to zero (unlocked signal) |
| `active` + `unsupported_at` | The owner's words stand; nothing supports them | Evidence hit zero on a **locked** (human-edited) signal — the text is theirs to keep, but it is excluded from synthesis |

Reconciliation (`reconcileSignalsAfterEvidenceLoss`) runs inside the
inspiration-delete transaction, under the same per-profile advisory lock as
derivation, so a delete racing a derivation cannot strand a signal on
evidence that no longer exists.

**Human edits.** Editing a signal's statement **locks** it (WAKA stops
rewording it), drops its stored vector immediately, queues a `reembed_signal`
job to compute the new one, and schedules a synthesis refresh. Deleting a
signal is allowed, cascades its evidence links, and also schedules a refresh.

The drop and the re-embedding are split because they cost different things.
Forgetting the old vector is a delete, and it cannot wait: a vector describing
the previous wording goes on matching captures to a pattern its owner has just
said they no longer hold. Computing the new one is a call on the shared model
key, and every such call belongs on the queue where the per-account budget
below can see it — the request path must not spend that key. In between, the
signal is not a match target, so a similar capture mints a visible
near-duplicate its owner can merge: the recoverable mistake, again.

### Is there a maximum number of signals?

**No hard cap on the total — by design.** A memory that refused to learn a
501st pattern would be lying about the person. What bounds growth instead:

- At most `MAX_SIGNAL_CANDIDATES` (3) candidates per capture — worst-case
  growth is linear in captures, and in practice far below it, because
- match-or-mint absorbs recurrence: growth tracks *distinct patterns*, not
  capture volume. The judge band and batch dedupe both push borderline cases
  toward attaching or collapsing rather than minting.
- Zero candidates is a sanctioned, prompted-for outcome.
- Evidence loss retires signals; retired rows stop being match targets.

Two knobs bound the *cost* of any signal count: matching scans only the
`MATCH_CANDIDATE_SCAN_LIMIT` (500) most recently evidenced signals (a pattern
dormant past the cut can spawn a duplicate — the recoverable mistake again),
and synthesis reads at most `TOP_OF_MIND_SIGNAL_LIMIT` (12). If profiles ever
hold many thousands of signals, move the cosine scan into pgvector; nothing
in the model changes, only where the arithmetic runs.

---

## Layer 2 → Layer 3: how the top of mind is generated

The pass is `packages/api/src/lib/top-of-mind-synthesis.ts`, and it is the
order of the four stages below and nothing else. Each stage is its own file,
named for the question it answers:

| Stage | File | Answers |
|---|---|---|
| 1. Selection | `packages/api/src/lib/top-of-mind-selection.ts` | which signals may be considered at all |
| 2. The live artifact | `packages/api/src/lib/top-of-mind-artifact.ts` | what the version standing now holds |
| 3. Validation | `packages/api/src/lib/top-of-mind-validation.ts` | what of the reply the database can vouch for |
| 4. Versioning | `packages/api/src/lib/top-of-mind-versioning.ts` | what the next version holds, and writing it |

Stages 1 and 3 are one guarantee in two halves: stage 1 filters candidates by
`signals.profileId`, and stage 3 checks the model's citations against exactly
that set. Neither is any use without the other.

### 1. What starts a refresh

| Trigger | Condition |
|---|---|
| A derivation completes | Only if it attached, minted, or promoted something — a capture that yielded nothing costs no synthesis **[checked]** |
| A signal is edited or deleted | Always (the artifact may cite it) |
| An inspiration is deleted | Always (its cascade may have retired signals) |
| Feedback is given | Always (a verdict changes what synthesis should weigh) |
| `POST /api/top-of-mind/refresh` | Manual, debounced |

Refreshes are debounced by a partial unique index (one pending/running
refresh per profile), with the same trailing-edge `rerun_requested` semantics
as derivation: signals changing mid-synthesis schedule exactly one follow-up.

### 2. Selection: deterministic, scored, bounded

`selectSignals` considers signals that are `active` (or `emerging` — see cold
start) and not `unsupported`, and scores each **[checked — weights sum to 1]**:

```
score = SELECTION_CONFIDENCE_WEIGHT (0.45) × confidence
      + SELECTION_EVIDENCE_WEIGHT   (0.2)  × support   (saturates at SELECTION_EVIDENCE_SATURATION = 6)
      + SELECTION_RECENCY_WEIGHT    (0.2)  × recency   (half-life SELECTION_RECENCY_HALF_LIFE_DAYS = 30)
      + SELECTION_COMEBACK_WEIGHT   (0.15) × comeback
      , then × SELECTION_DISPUTED_MULTIPLIER (0.4) if the owner's latest verdict is "not_true"
      , clamped to 0..100
```

**Comeback**: a signal that went quiet and returned outranks one that never
stopped — the return is the person's attention re-landing. It needs a real
gap (`COMEBACK_MIN_DORMANT_DAYS` = 21, saturating at
`COMEBACK_SATURATION_DAYS` = 90) and a recent return
(`COMEBACK_MAX_RETURN_AGE_DAYS` = 14).

**Disputed**: a multiplier, not an exclusion — the person may be wrong and the
pattern may return; a memory that silently drops whatever was disputed cannot
be argued with. The latest verdict wins, so a later "true" lifts an older
"not_true".

The top `TOP_OF_MIND_SIGNAL_LIMIT` (12) go to synthesis, ties broken by
recency then id, so identical data always selects identically.

**Cold start.** A new profile's signals are all `emerging` (nothing has
recurred three times yet), which used to mean `topOfMind: null` for days.
Below a floor of `TOP_OF_MIND_MIN_SIGNALS` (3) active signals, selection
borrows the strongest emerging ones — active first, only enough to reach the
floor — and marks the pass **provisional**, which tells synthesis to write
tentatively: questions and hypotheses, not asserted patterns. At or above the
floor the behavior is byte-identical to active-only, so an established
profile is never diluted with single-observation noise. The rule is the pure
function `chooseSelection` **[checked]**.

### 3. Synthesis: one call, the whole artifact

`synthesizeTopOfMind` receives the selected signals, the current live
entries, every **locked** entry, recent feedback (newest first, with the
person's own correction text), and the provisional flag. It returns the
**entire artifact** — at most `MAX_TOP_OF_MIND_ENTRIES` (7) entries, each
typed (`pattern`, `tension`, `question`, `hypothesis`, `action`), each citing
signal ids — or an explicit `noChange`.

Whole-artifact on purpose: a model asked to patch entries reasons about diffs
it cannot see, and every incremental variant of this call drifted into
appending. Temperature 0, schema-constrained, all signal statements and
feedback fenced as data.

### 4. What code enforces after the model answers

| Guarantee | Mechanism |
|---|---|
| Every cited signal exists and belongs to this profile | Citations validated against the DB; invented ones dropped; an entry left citing nothing is dropped with it. An artifact that cites nothing is a horoscope. |
| Locked entries survive **byte-identical** | Copied forward from storage, never from the model's reply — the model is asked to reproduce them and then not trusted to. Violations are counted and logged. |
| Pins, dismissals, locks survive regeneration | They are columns on entries, carried by code; the model never sees or controls them. |
| "Nothing changed" is a decision, not a silence | A no-move pass writes a version with reason `no_change` — a silent pass and a broken generator look identical from outside, and the old system hid failures in exactly that gap. |
| No concurrent writes to one artifact family | Per-owner advisory lock held across read-synthesize-write; entry edits take the same lock, so an edit cannot vanish under a concurrent regeneration. |
| Order-shuffled citations are not a change | The no-change comparison treats citations as a set. |
| Rejected content does not return | Entries whose latest verdict is `not_true` may not come back in the same form; corrections outrank model phrasing (prompt rule, backed by the disputed multiplier upstream). |

Versions form a chain: the previous live artifact is marked superseded and
points at its replacement. Nothing is mutated in place; history is walkable.

---

## How time is applied

Four terms read the clock; nothing else does. What matters is *when* each is
evaluated — a decay term only exists if something actually runs it.

| Term | Shape | Evaluated |
|---|---|---|
| Confidence recency (weight 15) | half-life `CONFIDENCE_RECENCY_HALF_LIFE_DAYS` (45) since the newest evidence | Live, at every personal read and every selection **[checked]** |
| Confidence spread (weight 30) | span of evidence, saturating at `CONFIDENCE_SATURATION_SPREAD_DAYS` (30) | Same — but monotonic: spread never shrinks as time passes |
| Selection recency (weight 0.2) | half-life `SELECTION_RECENCY_HALF_LIFE_DAYS` (30) since last evidence | Live, at every refresh |
| Comeback bonus (weight 0.15) | needs a gap ≥ `COMEBACK_MIN_DORMANT_DAYS` (21); the return must be ≤ `COMEBACK_MAX_RETURN_AGE_DAYS` (14) old | Live, at every refresh |

So a signal decays twice, on different clocks: its **confidence** fades with
a 45-day half-life on the recency slice, and its **selection score** fades
again with a 30-day half-life. Both are computed from the evidence timestamps
at the moment of the read — no cron rewrites scores, and a profile nobody
touches costs nothing. The stored confidence snapshot does *not* decay (it is
rewritten only when evidence changes), which is exactly why no personal
surface serves it — see the confidence section above.

Deliberate consequences:

- **Silence is information.** A quiet signal sinks in both confidence and
  selection, making room without anyone dismissing anything.
- **Scores floor rather than vanish.** Support and spread do not decay, so a
  well-evidenced dormant signal settles at a low-but-nonzero score instead of
  zero. Dormant patterns stay *reachable* — surfaced again the moment fresh
  evidence or a comeback lands — rather than deleted by arithmetic.
- **Returns beat persistence.** The comeback bonus pays for a gap plus a
  recent return, so a pattern that resurfaces after months outranks one that
  never went away. A comeback you did not act on within two weeks is history.

---

## Tuning constants

The authoritative values. Machine-checked against code — see
`packages/api/src/lib/generation-doc.test.ts`.

### Layer 2 — derivation (`packages/api/src/lib/signal-derivation.ts`)

| Constant | Value | One line |
|---|---|---|
| `SIGNAL_MATCH_MIN_COSINE` | 0.86 | At or above: attach as evidence |
| `SIGNAL_MERGE_JUDGE_MIN_COSINE` | 0.7 | Band floor: ask the judge instead of minting blind |
| `SIGNAL_BATCH_DEDUPE_MIN_COSINE` | 0.94 | Within one extraction batch, collapse near-identical candidates |
| `SIGNAL_PROMOTION_MIN_EVIDENCE` | 3 | Evidence count where emerging becomes active |
| `CONFIDENCE_SUPPORT_WEIGHT` | 55 | Confidence: weight of evidence count |
| `CONFIDENCE_SPREAD_WEIGHT` | 30 | Confidence: weight of time spread |
| `CONFIDENCE_RECENCY_WEIGHT` | 15 | Confidence: weight of recency |
| `CONFIDENCE_SATURATION_EVIDENCE` | 6 | Evidence count where support saturates |
| `CONFIDENCE_SATURATION_SPREAD_DAYS` | 30 | Spread saturates at this many days |
| `CONFIDENCE_RECENCY_HALF_LIFE_DAYS` | 45 | Recency half-life |
| `CONFIDENCE_SOURCE_DIVERSITY_BONUS` | 8 | Added when app and agent evidence corroborate |
| `MATCH_CANDIDATE_SCAN_LIMIT` | 500 | Most-recently-evidenced signals scanned per match |

### Layer 3 — synthesis (`packages/api/src/lib/top-of-mind-selection.ts`)

| Constant | Value | One line |
|---|---|---|
| `TOP_OF_MIND_SIGNAL_LIMIT` | 12 | Signals synthesis may consider |
| `TOP_OF_MIND_MIN_SIGNALS` | 3 | Cold-start floor; below it, emerging signals backfill |
| `SELECTION_CONFIDENCE_WEIGHT` | 0.45 | Selection: confidence term |
| `SELECTION_EVIDENCE_WEIGHT` | 0.2 | Selection: support term |
| `SELECTION_RECENCY_WEIGHT` | 0.2 | Selection: recency term |
| `SELECTION_COMEBACK_WEIGHT` | 0.15 | Selection: comeback term |
| `SELECTION_DISPUTED_MULTIPLIER` | 0.4 | Damping when the latest verdict is not_true |
| `SELECTION_EVIDENCE_SATURATION` | 6 | Support saturates at this evidence count |
| `SELECTION_RECENCY_HALF_LIFE_DAYS` | 30 | Selection recency half-life |
| `COMEBACK_MIN_DORMANT_DAYS` | 21 | Minimum gap for a return to count |
| `COMEBACK_SATURATION_DAYS` | 90 | Gap length where the bonus saturates |
| `COMEBACK_MAX_RETURN_AGE_DAYS` | 14 | A return older than this is just history |

### Model calls (`packages/api/src/queue/gemini.ts`, `packages/api/src/lib/inspiration-embeddings.ts`)

| Constant | Value | One line |
|---|---|---|
| `GEMINI_GENERATION_MODEL` | gemini-3.1-flash-lite | Extraction, judge, synthesis, vision |
| `GEMINI_EMBEDDING_MODEL` | gemini-embedding-001 | All vectors |
| `GEMINI_EMBEDDING_DIMENSIONS` | 768 | Vector width |
| `MAX_GEMINI_EMBEDDING_VALUES` | 4096 | Sanity ceiling on values accepted back per vector |
| `MAX_SIGNAL_CANDIDATES` | 3 | Statements one extraction may propose |
| `MAX_TOP_OF_MIND_ENTRIES` | 7 | Entries one artifact may hold |

All generation calls run at temperature 0 with schema-constrained JSON
output; all user-originated text and enrichment output is delimiter-fenced
and the system instructions pin the model against treating it as
instructions.

### The per-account model budget (`packages/api/src/lib/model-budget.ts`)

| Constant | Value | One line |
|---|---|---|
| `MODEL_BUDGET_WINDOW_MS` | 3600000 | The sliding window every count is taken over (1 hour) |
| `MODEL_BUDGET_JOBS_PER_ACCOUNT` | 60 | Job **starts** one account may take per window — see below for what a start is, and is not |
| `MODEL_BUDGET_RELEASE_MARGIN_MS` | 1000 | Nudge past the start that frees a slot, so a wake-up cannot re-read the same boundary |

One API key serves every account, so the queue's throughput *is* the key's
spend. Before claiming anything, the drain reads which account owns the head
of the queue and counts what that account has already started inside the
window. When the budget is gone it pushes that account's whole due backlog to
the moment the window frees a slot, and serves somebody else instead.

Nothing is refused and nothing is dropped: a deferred job is a pending job
whose `run_after` is later, which is the mechanism retry backoff already uses.
The budget is spent by jobs *starting*, not by jobs being enqueued — a
thousand saves waiting their turn have cost the key nothing — and it is
counted per **account** rather than per profile, because one account owns its
human profile and its agents.

**Every model call is a job**, including the one that used to be a request.
Editing a statement re-embedded it inside the PATCH, which meant one account
could spend the shared key at HTTP speed while this budget watched the queue.
That call is the `reembed_signal` job type now. The rule the code holds to is
flat: if it spends the key, it is a row in `background_jobs` — and
`packages/api/src/routes/model-spend-stays-on-the-queue.test.ts` fails the
build if a handler ever reaches a model entry point again.

**What 60 starts actually bounds**, stated precisely, because a protection
believed to be stronger than it is protects nothing:

- **Starts, not executions.** `started_at` is overwritten on each claim, so a
  job retried to its `max_attempts` (3) counts as one start, not three. The
  true ceiling is up to 180 job executions per account per hour. The undercount
  is bounded by `max_attempts` and by the backoff between attempts; the
  alternative is a second table logging every start, which is a whole ledger to
  maintain and reap for a correction of at most two.
- **Jobs, not model calls.** One `derive_signals` job is one extraction, one
  capture embedding, up to `MAX_SIGNAL_CANDIDATES` (3) candidate embeddings and
  up to 3 merge-judge calls: at most 8, and it is a real bound, because
  `parseSignalCandidates` slices the model's answer to the cap rather than
  trusting the schema constraint to have been honoured. Every other job type is
  one or two calls. So 60 starts is at most ~480 model calls an hour, times the
  retry factor above in the pathological case where every job fails twice
  before it succeeds.

---

## What the field shows, and why its numbers differ

Everything above decides what the machine CONCLUDES. This section covers what
a person SEES — an orb's brightness in the field — because that is also a
scoring model, and it used to be eight unnamed literals in a render loop
disagreeing with the five constants above.

Source: `packages/web/src/lib/aliveness.ts`.

| Constant | Value | What it does |
| --- | --- | --- |
| `FIELD_DECAY_HALF_LIFE_DAYS` | 7 | Half-life of an untended memory's light |
| `FIELD_REFLECTION_SATURATION` | 2 | Attention stops adding light past this many reflections |
| `FIELD_REFLECTION_WEIGHT` | 0.25 | What each reflection adds, as a fraction of current decay |
| `FIELD_FLOOR_CITED` | 0.34 | A memory a signal rests on cannot sink below this |
| `FIELD_FLOOR_ANSWERED` | 0.18 | Nor one you answered in your own words |
| `FIELD_FLOOR_IN_GROUP` | 0.1 | Nor one that is out loud in a group |
| `FIELD_CITED_LIFT` | 0.12 | Being cited also lifts a memory above its floor |
| `FIELD_FRONTIER_DAYS` | 3 | Untouched longer than this and cited by nothing = a frontier |

**Why the field decays faster than confidence.** 7 days against 45 and 30 is
deliberate. Those govern what the machine concludes over months; this governs
what a person sees on a surface they may open daily. A field that took a month
to visibly change would not show the passage of time, which is its only job.

That is an argument rather than a fact, and it is written down so it can be
argued with. The unacceptable state was the previous one: the same idea
carrying different numbers in two places with nothing connecting them.

**Why reflections saturate at 2 while evidence saturates at 6.** They count
different things. `SELECTION_EVIDENCE_SATURATION` counts a pattern accumulating
across many memories; `FIELD_REFLECTION_SATURATION` counts one person returning
to a single memory. Two returns to the same thought is already unusual.

**Why `hasNotes` appears twice.** A citation both sets a floor
(`FIELD_FLOOR_CITED`) and lifts the result (`FIELD_CITED_LIFT`): being rested
upon stops a memory sinking AND makes it brighter than an equally old one that
is not. Deliberate, and named so it reads as a decision rather than a bug.

## How this doc stays true

Three mechanisms, all in `packages/api/src/lib/generation-doc.test.ts`,
running in the standard unit suite (so CI blocks the drift):

1. **Constant pinning, both directions.** The test imports every exported
   tuning constant from the four modules above and asserts each appears in
   this doc's tables with exactly the code's value — and that every table row
   names a constant that actually exists. Add a constant to code and CI fails
   until it is documented here; change a value on either side alone and CI
   fails. Inline mentions of the form `CONSTANT_NAME (value)` in prose are
   checked the same way.
2. **Structural claims.** Everything marked **[checked]** is re-asserted as
   an invariant: threshold ordering (judge band < match < dedupe), weights
   summing to 1 and to 100, the cold-start floor never exceeding the
   selection limit, and the existence of the named functions.
3. **Path integrity.** Every repo path cited in this doc must exist. Rename a
   file and the doc must follow.

The convention that makes this cheap: behavior worth documenting lives behind
a **named export**. If a change has no named constant or function to point
at, that is the smell that it should get one first.

What the checks cannot catch is prose that mis-describes control flow, so the
change protocol is: **a PR touching derivation or synthesis behavior updates
this doc in the same diff**, and reviewers treat a mechanics change with no
doc diff the way they would treat one with no test diff.
