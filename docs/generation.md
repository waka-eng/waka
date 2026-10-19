# How WAKA generates memory

This is the mechanics companion to [data-model.md](data-model.md). That doc
says what the layers *are*; this one says how each layer is generated from
the one below — every rule, every number, and who decides what.

**This doc cannot silently drift from the implementation.** Every constant in
the [tuning tables](#tuning-constants) is machine-checked against the code by
`packages/api/src/lib/generation-doc.test.ts`, both directions, in the normal
unit suite — change a value on either side alone and CI fails. The same test
checks every inline `NAME (value)` mention, re-asserts every claim marked
**[checked]**, and verifies every file path cited here still exists. Prose can
lag in nuance; numbers and names cannot.

**One sentence governs every layer,** and it is worth reading the rest of the
doc through: *the model writes sentences, the numbers make decisions, and
every checkable claim the model makes is checked.*

The pipeline in one picture:

```
  capture ──► enrichment ──► extraction ──► embed ──► match-or-mint ──► evidence
 (layer 1)   (links/images)  (model, ≤3)   (768d)    (attach/judge/mint)    │
                                  ▲                                         │
              related earlier captures (≤5, retrieved by                    │
              capture-vector cosine; citable as evidence                    │
              only with a code-verified verbatim quote)                     │
                                                                            ▼
                                                              confidence + promotion
                                                              (emerging → active at 3)
                                                                            │
                            top of mind (layer 3) ◄── synthesis ◄── selection
                            one versioned artifact    (model, ≤7)   (score, ≤12)
```

---

## The life of one inspiration

The pipeline, told as one capture's story. Say you save: *"Turned down the
platform-team offer. I keep choosing depth over breadth."*

1. **Capture.** The text lands as an inspiration — yours, editable,
   deletable, never shared. A link or image is enriched in the background
   (page fetched, image described) and the capture re-derives when that
   lands.
2. **Related captures.** Your save's vector is compared against your earlier
   saves'. The nearest few are shown to the extractor as context — so if you
   wrote about quitting piano "because practice felt like performance"
   months ago, today's save about abandoning the blog for the same reason
   can cite it, and both become evidence of one pattern neither save could
   witness alone.
3. **Extraction.** One model call reads the capture (plus reflections,
   enrichment, and those related saves) and proposes at most three pattern
   statements — here, likely one: "You keep choosing depth over breadth."
   Zero is a valid answer; a grocery list yields nothing.
4. **Match or mint.** Each statement is embedded and compared against your
   existing signals by cosine distance. Said before in other words → the
   capture **attaches as evidence** of that signal. Genuinely new → a signal
   is born `emerging`. In the ambiguous band, one judge call breaks the tie.
5. **Recurrence decides.** At three pieces of evidence the signal promotes
   to `active`. One mention is a thought; three are a pattern.
6. **Confidence follows the evidence** — how much, how spread out over time,
   how recent, whether an agent corroborated it — recomputed at every read,
   so a pattern you stop feeding fades without anyone touching it.
7. **Selection.** When the signal set changes, a refresh scores every
   eligible signal and takes the strongest twelve. New profiles borrow their
   best still-forming signals so the board is never blank.
8. **Synthesis.** One model call returns the whole top of mind — at most
   seven entries, each citing the signals it rests on. Code validates every
   citation, restores your locked entries byte-for-byte, and writes the next
   **version**. The old one is superseded, never erased.
9. **You push back.** Edit an entry (it locks), pin it, dismiss it, or mark
   it *not true* — the next synthesis is told, and your correction outranks
   the model's phrasing. Delete the original inspiration and the chain
   unwinds: evidence gone, signal retired or marked unsupported, artifact
   re-synthesized.

Everything below specifies each step precisely.

**Generation commits against the inputs it read.** Personal/room synthesis and
principle generation capture an internal profile generation revision before
loading inputs. Source, evidence, statement, relevant room and human-edit
changes advance it transactionally. A final locked comparison rejects stale
results, including a change followed by a revert. Private reflection changes
do not advance a room's revision. Worker-driven artifact/principle writes also
check their job claim inside that transaction; a reclaimed worker cannot write
output merely because the material happens to be unchanged. No model call is
made while those final locks are held.

Principle comparisons are planned as a whole batch before any write, including
comparisons against candidates about to be minted. A failed later comparison
therefore leaves no partial principle batch. These are commit guarantees, not
proof that an already-published reading remains supported after a later edit.

---

## Layer 1 → Layer 2: how a signal is generated

**The whole layer in one table.** Existing support is checked separately before
discovery. Then the inspiration flows through the seven discovery/lifecycle
decisions below. A model proposes meaning and assesses support; code validates
identities, permissions, revisions and standing. A valid ID or literal quote
alone does not prove a model's semantic judgment correct.

| # | Decision | Decided by | The rule |
|---|---|---|---|
| 0 | Does this inspiration's current material still support each previously linked claim? | **Model, explicit assessment** | Supported keeps/restores the link; unsupported withdraws it; unresolved, unavailable or omitted verdicts do not withdraw. Same-policy checks are reusable only for identical material and wording. |
| 1 | Which earlier captures are worth showing alongside this one | Arithmetic | cosine over stored capture vectors — floor `RELATED_INSPIRATION_MIN_COSINE` (0.6), strongest `RELATED_INSPIRATION_CONTEXT_LIMIT` (5) of the `RELATED_INSPIRATION_SCAN_LIMIT` (500) most recent |
| 2 | Is there a supported pattern or current interest here, and in what words | **Model** | 0 to `MAX_SIGNAL_CANDIDATES` (3) statements — zero is a sanctioned answer; its quote is kept only if it is a verbatim span of the capture |
| 3 | Which earlier captures co-witness a statement | **Model proposes, code verifies** | at most `MAX_RELATED_INSPIRATION_CITATIONS` (2) per statement; only ids that were actually offered; each citation needs a verbatim quote from the cited capture's own text or it is dropped whole |
| 4 | Same pattern as an existing signal, or a new one | Arithmetic — model tie-break inside one band | ≥ `SIGNAL_MATCH_MIN_COSINE` (0.86) attach as evidence · below `SIGNAL_MERGE_JUDGE_MIN_COSINE` (0.7) mint new · in between, one judge call where **uncertainty mints** |
| 5 | Does the pattern count as real | Arithmetic | `SIGNAL_PROMOTION_MIN_EVIDENCE` (3) evidence rows: `emerging` becomes `active` |
| 6 | How strong is it right now | Arithmetic | the confidence formula below, computed fresh at every read, over evidence dated by capture time |
| 7 | What happens when its evidence is deleted | Arithmetic | at zero evidence an unlocked signal retires; a human-edited one keeps its words, marked unsupported and excluded from synthesis |

Decisions 1–4 happen inside one derivation job; 5–7 are pure code a test can
pin exactly. The subsections below take the steps in the same order.

A standalone signal need not describe an enduring preference. Extraction keeps
the person's time limits, uncertainty and level of commitment: one event or
temporary wish cannot become a habit, necessity or lasting belief merely through
paraphrase. Repeated behavior requires actual repeated evidence or the person's
explicit account. Gender and other personal facts cannot be inferred from a
neutral capture. Promotion/confidence thresholds and wording locks remain the
separate rules below.

When earlier captures are supplied, an explicit author-written choice rule is
kept apart from the particular event and from evidence narration. Earlier IDs
belong in structured citations. Both provider parsers refuse generated wording
that copies supplied internal IDs absent from current material, or exceeds the
statement ceiling, before it can be truncated/published. Technical IDs actually
present in the person's current material remain allowed. This adds no matching,
promotion, confidence or human-lock change.

### 1. What starts a run

| Event | Reason recorded | Where |
|---|---|---|
| A capture lands (`POST /api/inspirations`) | `created` | `packages/api/src/routes/inspirations.ts` |
| A capture's text or kind is edited | `edited` | same |
| A reflection is added or removed | `edited` | same |
| An attachment's cached enrichment changes | `edited` (re-derive with new context) | `packages/api/src/lib/signal-enrichment.ts` |

Deleting an inspiration does **not** start a derivation — it runs the
reverse operation (step 7) inside the delete transaction.

Source writes and their jobs commit together. Personal and room destinations
have separate keys; creation and edits for one source/destination share a key,
so a burst coalesces into one run. An edit landing while a run is executing sets
`rerun_requested`: the running pass read its inputs before the edit existed,
so on completion the job runs exactly once more. A trailing edit is never
lost, including when the older attempt fails. **[checked]** Worker waking happens
after commit; a failed wake cannot erase the saved job. Reflection-only changes
queue personal work, never room derivation. Turning a public source private
queues room rereading without sending private material into a room pass.

Before discovery, existing and previously withdrawn links receive explicit
support assessment. Each automatic attempt makes at most one support call
(up to 12 claims); remaining or unavailable checks request another attempt.
Previously settled same-policy/same-material/same-wording checks are reused,
so retries advance rather than repeatedly paying for the first batch. A genuine
unresolved verdict is retained distinctly from transport or malformed-output
failure. Explicit operator reviews can force fresh assessment of unchanged
material. No deleted quote is restored with a recovered relationship.

### 2. What the model gets to read

Everything is bounded, provenance-labeled, and fenced:

- **The capture itself.** Inputs are clipped on the way in, and whatever the
  model returns is clipped again in code — statements to 500 characters.
- **Your reflection answers** — personal passes only; never room inputs.
- **Link enrichment** — the page is fetched with per-hop SSRF checks (every
  redirect re-validated, private ranges refused unless allowlisted via
  `WAKA_ENRICHMENT_ALLOWED_HOSTS`), under a hard timeout and byte cap, then
  reduced to body text. **Image enrichment** — a temperature-0 vision call
  transcribes legible text verbatim and describes the image.
- **Up to `MATCH_CANDIDATE_SCAN_LIMIT` (500) of your existing statements** —
  *for phrasing consistency only*; matching is decided by distance, below.
- **Related earlier captures** — see step 3.

Enrichment is derived context, never content: it lives on the attachment
row, is labeled machine-derived when shown, and arrives in every prompt
fenced as untrusted data. A web page that says "ignore your instructions" is
a string, not an instruction.

### 3. Related captures, and what the model may propose

Per-capture reading is structurally blind to how people actually recur: the
same theme returning months later, worded differently, across saves that
individually look like nothing. So before extraction:

1. The capture's own vector (already maintained for layer-1 recall — the
   reorder costs no extra model call) is compared against the profile's
   stored capture vectors: the `RELATED_INSPIRATION_SCAN_LIMIT` (500) most
   recent are scanned.
2. Anything at or above `RELATED_INSPIRATION_MIN_COSINE` (0.6) qualifies;
   the strongest `RELATED_INSPIRATION_CONTEXT_LIMIT` (5) enter the prompt,
   each in its own fence with its id and date.

The extraction call (`extractSignalCandidates` — interface in
`packages/api/src/lib/model-provider.ts`, implementation in
`packages/api/src/queue/gemini.ts`) then returns **0 to
`MAX_SIGNAL_CANDIDATES` (3)** candidate statements. The contract:

- **Zero is a right answer.** A model that pads output mints noise, and
  noise is the failure mode this whole layer exists to prevent.
- **Statements are patterns, not summaries** — "You keep returning to X",
  never "this note is about X".
- **Quotes must be verbatim spans.** Absent is honest; invented is not. The
  primary quote is verified in code against the capture's own text
  (`packages/api/src/lib/salience.ts`) and dropped if it is not there —
  including a span from attachment enrichment: only the person's OWN words
  survive as evidence quotes now. `signal_evidence.quote_source` remains on
  the row (`own` / `enrichment` / null): new rows carry `own` or null, and
  older rows keep whatever they were verified as, because the two are
  different claims about a person and must never render alike.
- **Related captures are context, not material.** Every statement must be
  grounded in the current capture first; a pattern living only in the
  earlier captures is not the model's to name. When an earlier capture
  *does* independently witness a statement, the model may cite it — at most
  `MAX_RELATED_INSPIRATION_CITATIONS` (2) per statement — and code then
  drops any cited id that was not actually offered and verifies each
  citation's quote against the cited capture's text
  (`resolveRelatedEvidence`). A citation whose quote fails is dropped whole:
  "these two share a theme" is not "this capture witnesses this pattern",
  and the verbatim quote is the difference.
- **The capture's own subject rides on the same call.** The pass also names
  what the capture is ABOUT, in one or two plain words, as the archive's
  shelves. It is a fact about the capture (layer 1), not about any statement
  drawn from it, so a capture that yields zero statements still has one. It
  rides here rather than taking a call of its own because this call already
  reads the whole capture, its reflections and its attachments — and a second
  round-trip per save would be charged against the one act the product
  promises costs nothing.
  - The reading is shown the shelves this archive already uses, busiest
    first, at most `MAX_EXISTING_CATEGORIES` (24), and told to reuse before
    it coins. Without that, a model names each capture with a fresh phrase
    and fifty saves become fifty categories of one — a filter where every
    option holds one thing, which is worse than no filter.
  - At most `MAX_CATEGORY_CHARS` (32) characters. Longer than that is a
    sentence, not a shelf, and it has to fit in a tab.
  - Free text rather than an enum, deliberately: an enum would be a taxonomy
    decided once for everybody, and the claim this product makes is that what
    a person keeps about is particular to them. The vocabulary converges per
    archive instead of being constrained across all of them.
  - `null` is a real answer and the default. A capture the reading cannot
    place stays unplaced; nothing downstream may read null as a category
    named "null". A pass that returns null also leaves an existing shelf
    alone — "could not place it this time" is not "it belongs nowhere".
- Temperature 0, JSON schema-constrained, caps re-enforced in code
  regardless of what the model returns.

### 4. The matching math

Each surviving candidate is embedded (`gemini-embedding-001`, 768
dimensions — the same family as capture embeddings, see
`packages/api/src/lib/inspiration-embeddings.ts`). Then, in order:

**Batch dedupe.** Candidates from one reply are compared to each other; at
cosine ≥ `SIGNAL_BATCH_DEDUPE_MIN_COSINE` (0.94) they collapse — a model
that says the same thing twice in one reply mints once.

Next, the ground refuses: each candidate is compared against the vectors of
the profile's **dismissed** signals (rows whose `dismissed_at` is set — the
owner threw the pattern out, and the row, evidence and embedding all stayed).
At or above `SIGNAL_SUPPRESSION_MIN_COSINE` (0.86) to any dismissed anchor,
the candidate is dropped — no mint, no evidence, no judge call — and a
`suppressions` row is written naming the anchor, snapshotting both statements
and the cosine that decided. Every refusal is on the record; restoring the
dismissed signal (clearing `dismissed_at`) returns the pattern to the loop's
sight. Checked before the match on purpose: a pattern the owner refused must
not re-enter as evidence for something else **[checked]**.

**Match-or-mint.** Each candidate is compared against the profile's existing
signal vectors — the `MATCH_CANDIDATE_SCAN_LIMIT` (500) most recently
evidenced — and the nearest neighbor's cosine decides. This is
`classifyMatch` in `packages/api/src/lib/signal-derivation-thresholds.ts`,
applied by `packages/api/src/lib/signal-match-or-mint.ts` **[checked]**:

| Similarity to nearest existing signal | Decision |
|---|---|
| ≥ `SIGNAL_MATCH_MIN_COSINE` (0.86) | **Attach** — the capture becomes evidence of that signal |
| ≥ `SIGNAL_MERGE_JUDGE_MIN_COSINE` (0.7), < 0.86 | **Ask the judge** — one bounded model call: "do these two statements name the same durable pattern?" Yes → attach; no, uncertain, or any failure → mint |
| < 0.7, or no comparable vector | **Mint** — a new signal is born `emerging` |

The asymmetry is deliberate. A wrong merge fuses two patterns invisibly and
corrupts both evidence trails; a wrong mint is a visible near-duplicate the
owner can merge or delete. When this system errs, it errs recoverably —
which is why the judge is told that uncertainty means different, and why
every malformed or failed judge response also lands on mint.

**Writing evidence.** Attaching writes a `signal_evidence` row (M:N — one
capture can evidence several signals; one signal accumulates many captures),
unique per (signal, inspiration) pair so re-derivation never double-counts.
Surviving related-capture citations attach the same way, to whichever signal
the candidate landed on: ordinary evidence rows, quote carried, reason null
(the quote is the grounding). A cited capture deleted between retrieval and
the write is skipped, not an abort.

While a signal is still `emerging` and unedited, a confirming capture may
also **restate** it — the second observation usually names the pattern
better than the first. Once `active` or human-edited, the wording is
settled.

### 5. Promotion

```
evidence_count ≥ SIGNAL_PROMOTION_MIN_EVIDENCE (3)   →   emerging → active
```

Promotion is enforced twice: in the lifecycle pass
(`packages/api/src/lib/signal-lifecycle.ts`) and by the Postgres transition
guard (`drizzle/migrations/0057_review_evidence.sql`). This is not a
residence rule: an already-active signal can lose some evidence, and a locked
unsupported signal keeps its human wording. Neither a direct insert nor an
emerging-to-active transition may bypass the promotion bar.

### 6. Confidence

Confidence (0–100) is a pure function of the evidence set and the clock —
`computeSignalConfidence`, no model anywhere:

Identified provenance first passes through `selectIndependentEvidence` in
`packages/api/src/lib/signal-lifecycle.ts`. Direct originals take priority;
each counted unit needs its own available source origin. Review-session units
group repeated replies rather than count each citation as an
experience. Dates belong to the supporting unit for its matched origin, not
older context or a later retry. Anonymous legacy arithmetic inputs remain
supported on their own but cannot be mixed with identified units. See the
independent-support contract in [data-model.md](data-model.md).

Review-to-signal processing is connected through the durable
`derive_review_answer` queue job and `review-answer-derivation.ts`. It first
reassesses existing support in bounded batches, then discovers new statements
from the saved human answer. Current-material and generation checks fence the
writes; a failed discovery does not undo an already committed withdrawal.
Review processing records its downstream reading request and result for the UI.
Migration 0057 supplies owned support references and source revisions. The common
`signal_support_edges` query includes only current witnesses in counting, while
reporting stale relationships as pending rather than unsupported. Personal
readers recognize raw and review support; room readers still use public raw
material only. The database promotion guard uses the same maximum-matching
count, stops once three witnesses are proven, and cannot count a stale material
or statement revision as a new promotion. The answer stays a review answer;
processing does not copy it into multiple inspirations. Room readers still
exclude personal review evidence. No numerical promotion threshold changed.

```
support = min(1, n / 6)                 n = evidence count; 6 = CONFIDENCE_SATURATION_EVIDENCE
spread  = min(1, span_days / 30)        span = newest − oldest evidence; 30 = CONFIDENCE_SATURATION_SPREAD_DAYS
recency = 2^(−quiet_days / 45)          quiet = days since newest; 45 = CONFIDENCE_RECENCY_HALF_LIFE_DAYS

confidence = round( 55·support + 30·spread + 15·recency + diversity + affirmed )
             where diversity = CONFIDENCE_SOURCE_DIVERSITY_BONUS (8)
             when evidence spans app AND agent capture, else 0
             and affirmed = CONFIDENCE_AFFIRMED_BONUS (30)
             when the owner's LATEST verdict on the signal is "true", else 0
             — clamped to 0..100
```

The weights are `CONFIDENCE_SUPPORT_WEIGHT` (55),
`CONFIDENCE_SPREAD_WEIGHT` (30), `CONFIDENCE_RECENCY_WEIGHT` (15) — summing
to 100 **[checked]**. Diversity and affirmation are *bonuses*, not
weights: most profiles are app-only and most signals are unanswered, and a
weight would cap them below 100 forever. Corroboration adds; its absence
must not subtract. The affirmed bonus is the owner's own "yes, this is me"
(latest verdict wins, the same read selection makes) — an answer weighing on
the number the world lights by, not only on selection. "not_true" is
deliberately NOT mirrored here: disputed already moves selection through
`SELECTION_DISPUTED_MULTIPLIER`, and cutting confidence too would count one
answer twice. Room statements take no affirmed term — they answer to member
stances, not to a single owner's verdict.

**Worked example.** Four pieces of evidence spanning 20 days, the newest 10
days ago, all typed by the person:

```
support = 4/6  = 0.667   →  55 × 0.667 = 36.7
spread  = 20/30 = 0.667  →  30 × 0.667 = 20.0
recency = 2^(−10/45) = 0.857 → 15 × 0.857 = 12.9
                                     total ≈ 70
```

The same signal 45 days later, untouched: support and spread are unchanged,
recency has halved twice over (2^(−55/45) ≈ 0.43), and confidence drifts to
≈ 63 — fading, but floored well above zero, because support and spread never
decay. A well-evidenced dormant pattern stays reachable.

Two rules about *when* and *what* the formula reads:

- **Computed live at every read.** `GET /api/signals` (list and detail, so
  web and MCP inherit it) and layer-3 selection recompute confidence from
  the evidence rows at request time **[checked]**. That is what makes the
  recency term real: a quiet signal fades with no write and no cron.
- **Every date is the cited capture's own `created_at`** — when the
  witnessing happened, never when the evidence link was written. Live since
  related-capture citations exist: an old save cited today widens the
  spread term with its months-old date and cannot pose as fresh recency.

A snapshot *is* stored on the signal row, rewritten whenever evidence
changes — at the exact moment the recency term peaks, so it can only ever
overstate a signal that has since gone quiet. No personal surface serves
it. It exists as a coarse SQL pre-sort, and as what the **group wall** shows
— the wall's query is deliberately unable to reach `signal_evidence` or
`inspirations` (a member must never touch another member's private layers),
which makes it the one documented staleness in the system.

### 7. When evidence is deleted

Status is a fact about support — computed, never guessed:

| State | Meaning | How it happens |
|---|---|---|
| `emerging` | Seen, not yet recurred | Minted; below 3 evidence |
| `active` | A durable pattern | Crossed 3 evidence |
| `retired` | Support fell away | Evidence deleted to zero (unlocked signal) |
| `active` + `unsupported_at` | The owner's words stand; nothing supports them | Evidence hit zero on a **locked** (human-edited) signal — the text is theirs, but it is excluded from synthesis |

Reconciliation runs inside the inspiration-delete transaction, under the
same per-profile lock as derivation, so a delete racing a derivation cannot
strand a signal on evidence that no longer exists.

**Human edits.** Editing a signal's statement locks it (WAKA stops rewording
it), drops its stored vector immediately, and queues a `reembed_signal` job
for the new one. The drop cannot wait — a vector for the old wording would
keep matching captures to a pattern its owner just said they no longer hold
— but the re-embed is a model call, and every model call belongs on the
queue where the per-account budget can see it. In between, the signal is
simply not a match target; a similar capture mints a visible near-duplicate.
The recoverable mistake, again.

The re-embedding worker reuses a current model/input hash without another
provider call. Otherwise it verifies current statement text and its worker
claim in the final cache transaction. Concurrent valid output wins over both
a slow success and a slow failure; neither path deletes another model's rows.
A provider failure without valid current output removes only the mismatched
model cache and requests the queue's bounded retry, not silent success. Source,
claim and database failures remain failures rather than triggering that cache
cleanup. No lock spans the embedding call, and a busy human-edited statement
makes the worker retry instead of waiting back on the person.

### Asking the memory (`GET /api/recall?q=…`)

The one door that turns the memory from something a mind receives into
something it can ask. The question embeds as a `RETRIEVAL_QUERY` — the
other half of the asymmetric pairing every stored vector was written in —
and cosine runs in process over the standing signals' vectors: at or above
`RECALL_MIN_COSINE`, strongest first, at most `RECALL_LIMIT`, each match a
signal with live confidence. Never raw captures: recall answers "what do
they think", and the capture behind a thought stays behind its own doors.
Access is the read matrix unchanged, and every serve writes the same
`signals` consultation row a list-read writes — a question about someone's
mind is a read of it.

### Is there a maximum number of signals?

**No hard cap — by design.** A memory that refused to learn a 501st pattern
would be lying about the person. Growth is bounded structurally instead: at
most `MAX_SIGNAL_CANDIDATES` (3) candidates per capture, recurrence absorbed
by attach rather than mint, batch dedupe, and zero as a sanctioned outcome —
so growth tracks *distinct patterns*, not capture volume. Cost is bounded
separately: matching scans only the `MATCH_CANDIDATE_SCAN_LIMIT` (500) most
recently evidenced signals, and synthesis reads at most
`TOP_OF_MIND_SIGNAL_LIMIT` (12). If profiles ever hold many thousands of
signals, the cosine scan moves into pgvector; nothing in the model changes,
only where the arithmetic runs.

---

## Layer 2 → Layer 3: how the top of mind is generated

The pass lives in `packages/api/src/lib/top-of-mind-synthesis.ts` and runs
four stages in order: **select** which signals may be considered, read the
**live artifact** as it stands, **synthesize** the whole next artifact in one
model call, then **validate and version** what came back. All four stages,
and every Layer 3 constant in the tables below, are in that one file. A
`top-of-mind-selection.ts` once mirrored the ranking stage constant for
constant and function for function; nothing imported it but the drift lock,
so the lock was holding the copy rather than the code, and it is deleted.

Selection and validation are one guarantee in two halves: selection filters
candidates to this profile's signals, and validation checks the model's
citations against exactly that set. Neither is any use without the other.

### 1. What starts a refresh

| Trigger | Condition |
|---|---|
| A derivation changes evidence | Only if it attached, minted, promoted, explicitly withdrew or restored support. Empty discovery with unchanged support requests no synthesis; explicit withdrawal can request one even with no new candidates. The job commits with the change. **[checked]** |
| A required earlier read failed or disappeared | Processing recovery restores that outstanding dependency. This does not make every no-change capture buy another synthesis. |
| A signal is edited or deleted | Always (the artifact may cite it) |
| An inspiration is deleted | Always (its cascade may have retired signals) |
| Feedback is given | Always (a verdict changes what synthesis should weigh) |
| `POST /api/top-of-mind/refresh` | Manual, debounced |
| The profile's language changes | Always (`PATCH /api/auth/me/preferences`) — the artifact must re-speak in the new language, not wait for an unrelated refresh |

Source processing and job success are distinct. A pass records successful
derivation against the exact source revision and claimed request; publication
records the actual artifact in the same transaction as its processing receipt
and eligible principle enqueue. A read finishing during extraction is retained
without premature completion. The final no-change pass can use that result,
including after its job was cleaned up, while a changed pass binds a new read.
Room jobs waiting for affirmations produce no publication receipt. These are
backend facts for progress reporting, not extra public maturity labels.

Authored save identity is separate again. Capture and answer POSTs may carry a
UUID `Idempotency-Key`; source/answer rows, their numbered processing request,
and `inspiration_save_requests` commit atomically. Replaying that identity with
the same normalized input reads the current saved item instead of enqueueing
again. A different input conflicts, and a deleted result stays deleted. The
save acknowledgment (201 for new, 200 for replay) proves only that the words
were accepted, not that any derived reading completed. The save-request lookup
is metadata-only and never starts generation. A missing lookup can overlap an
in-flight transaction and must not cause a client to invent another identity.

`GET /api/inspirations/:id/processing` follows an authorized personal receipt
to the newest request for current material, with separate derived/completed
counters. A published result is hidden until derivation and its dependency
complete; cleanup of a job does not erase an already committed result. Pending
enrichment, an active lease, a scheduled hold, failure and unknown legacy work
are distinct internal observations. The response carries no source/provider
text and does not enqueue work. `POST /:id/processing/retry` rechecks those
facts under locks and resumes only the missing/failed enrichment, derivation or
read; it neither resaves source material nor upgrades automatic work to manual.
Read-only access cannot recover work. The client preserves the exact save
reference, checks rather than repeats an ambiguous recovery POST, and offers
“See reading” only after confirmed completion. Opening it rechecks current
processing and fetches that artifact or a newer live reading; ready status
alone never replaces a headline. Saved-word idempotency is a separate required
contract, not something these processing receipts claim to provide.

Refreshes are debounced to one pending pass per profile, with the same
trailing-edge `rerun_requested` semantics as derivation.

Queue acceptance is not completion. The worker stores a metadata-only result
with its owned claim's final status; a rerun keeps the receipt unavailable
until the trailing pass finishes. The profile-scoped refresh-status endpoint
returns the completed top-of-mind ID/version and changed/unchanged/empty
outcome, never provider errors or source text. Clients fetch that completed
or a newer live version before reporting success. Worker claim checks fence
job settlement; source-revision fencing is a separate requirement.

**And the board shifts at most once a day.** An automatic
(`signals_changed`) refresh that arrives while the latest CONTENT version —
reason ≠ `no_change`; the honest no-change rows record that a read
happened, not that the board moved — is younger than
`TOP_OF_MIND_MIN_SHIFT_HOURS` is **held**: its row sleeps until the floor
opens (`run_after = lastShift + 24h`), further enqueues collapse into it,
and signals keep accruing underneath so the one shift that lands reads
everything. A hold is not a failure — no error, no attempt spent. The
sleeping row runs on the next wake after the floor opens (any keep wakes
the worker; an absent profile's shift lands with the daily sweep). Two
exemptions, both deliberate: `manual` refreshes — the person's own "Read it
again", a language change — never wait, and a profile with no content
version yet has nothing to hold stable. The machine holds a day; the person
never does.

A manual request also upgrades an already-held automatic row and wakes it.
Known reading jobs enqueued or claimed during an asynchronous drain can request
the existing bounded Lambda redelivery when short debounce/support waits outlive
that drain. The wake checks job/profile/version, unread pending state, lease,
attempt and near-term due time; it does not scan unrelated work or bypass budget
or daily-floor checks. Automatic trailing requests retain their cadence rule.
Automatic requests arriving after a manual pass remain automatic; they do
not inherit its bypass. All starts still pass the account's model budget.

### 2. Selection: deterministic, scored, bounded

Eligible personal signals are `active` (or qualified `emerging` — see current
focus and the cold start),
not dismissed or unsupported, with owned current evidence and no foreign-owner
witnesses. This is the same standing predicate used by personal reading
projection; a signal hidden there cannot immediately regenerate the conclusion.
Each is scored — `computeSelectionScore`, weights summing to 1
**[checked]**:

```
support  = min(1, n / 6)              6 = SELECTION_EVIDENCE_SATURATION
recency  = 2^(−quiet_days / 30)       30 = SELECTION_RECENCY_HALF_LIFE_DAYS
comeback = 0 unless the gap before the newest evidence was ≥ 21 days
           (COMEBACK_MIN_DORMANT_DAYS) AND that newest evidence is ≤ 14
           days old (COMEBACK_MAX_RETURN_AGE_DAYS); then it scales linearly
           with the gap, saturating at 90 days (COMEBACK_SATURATION_DAYS):
           comeback = min(1, (gap − 21) / (90 − 21))

score = 0.45·confidence + 0.2·support·100 + 0.2·recency·100 + 0.15·comeback·100
        × 0.4 if the owner's latest verdict on this signal is "not_true"
        — clamped to 0..100
```

with `SELECTION_CONFIDENCE_WEIGHT` (0.45), `SELECTION_EVIDENCE_WEIGHT`
(0.2), `SELECTION_RECENCY_WEIGHT` (0.2), `SELECTION_COMEBACK_WEIGHT`
(0.15), and `SELECTION_DISPUTED_MULTIPLIER` (0.4).

**Worked example.** Confidence 70, four evidence rows, newest 10 days ago,
no comeback: 0.45×70 + 0.2×66.7 + 0.2×79.4 + 0 ≈ **61**. The same signal
after its owner marked it *not true*: 61 × 0.4 ≈ **24** — dampened, still in
the race. Disputed is a multiplier, not an exclusion: the person may be
wrong, the pattern may return, and a memory that silently drops whatever was
disputed cannot be argued with. The *latest* verdict wins, so a later "true"
lifts an older "not_true".

**Comeback** exists because a signal that went quiet and returned outranks
one that never stopped — the return is the person's attention re-landing. A
60-day gap with a return 5 days ago scores comeback = (60−21)/(90−21) ≈
0.57, worth about 8.5 points.

Up to `TOP_OF_MIND_SIGNAL_LIMIT` (12) go to synthesis. Up to
`TOP_OF_MIND_FOCUS_LIMIT` (3) diverse signals supported within
`TOP_OF_MIND_FOCUS_DAYS` (14) days lead, ordered by recency, score and id.
An emerging focus needs `TOP_OF_MIND_EMERGING_MIN_EVIDENCE` (2) independent
current units on an established profile. Ranked active patterns fill the
remaining slots. These are selection allowances, not signal promotion or
Principle thresholds; a single incidental save cannot displace the board.
The automatic 24-hour shift floor is unchanged.

**Cold start.** Below a floor of `TOP_OF_MIND_MIN_SIGNALS` (3) active
signals, selection borrows the strongest emerging ones — active first, only
enough to reach the floor — and marks the pass **provisional**, which tells
synthesis to write tentatively. Status is supplied per signal: a new interest
does not weaken an established pattern elsewhere in the artifact. At or above
the floor only qualified recent emerging focuses enter; there is no incidental
single-observation backfill. The rule is the pure function `chooseSelection`
**[checked]**.

**No two voices on the board saying one thing.** After scoring, the ranked
list takes one greedy diversity pass (`diversifyRanked`): a candidate whose
embedding sits at or above `SELECTION_DIVERSITY_MAX_COSINE` to an
already-accepted one yields its slot. Empty slots are not refilled with echoes;
the source signals remain in memory, neither deleted nor demoted. Only current
statement hashes participate in this comparison. The bar sits inside the judge
band on purpose: at 0.8 the pair is
close enough that derivation would already be asking whether they are the
same pattern, while genuinely different signals about one theme are
untouched. Deterministic, cosine in process over the stored vectors, no
model anywhere.

**A tension needs both voices.** When a chosen signal stands in an open
contested pair (the judge answered `opposed` and the owner has not
arbitrated), its partner is pulled into the selection behind it — the list
may exceed the twelve slots by the pulled few, because delivering one side
of a dispute as if it were alone would be the machine quietly arbitrating,
and the machine never arbitrates. A partner that is no longer standing
(retired, unsupported) cannot speak, and the pair stays dormant for that
pass. Each side is then marked `contested with:` the other's id — only ever
an id in the same delivered list, so the mark is always citable. The prompt
tells the synthesis what the mark means: live tension material, written as
a `tension` citing both ids when it matters now, and never one side alone
asserted as a settled pattern or belief while the dispute stands. Personal
publication also rejects a generated entry citing a disputed side unless it
is a tension citing both sides, and clears a separate settled belief from
that machine tension. A no-change carry uses the same rule. Human locks/pins/dismissals still preserve exact
words; the machine never rewrites those choices to resolve a dispute.
Carry checks include current standing disputes outside this pass's selection.
Its optional machine belief may repeat the body or an exact cited statement,
but cannot add a second stronger inference; human-owned fields remain exact.

### 3. Synthesis: one call, the whole artifact

`synthesizeTopOfMind` receives the selected signals — each carrying its
**time shape**, the pattern's life worded deterministically from the
evidence dates ("held for 4 months; last fed 2 weeks ago", "returning
after 5 weeks quiet", "new this week"), so the model can tell an anchor
from an arrival and name a comeback as one — the currently supported live entries,
every **locked or pinned** entry, recent feedback (newest first, with the
person's own correction text), and the provisional flag. The prompt
forbids narrating the metadata itself: time chooses what leads and how
firmly each thing is said, and never appears as dates or counts in the
artifact. It returns the
**entire artifact** — at most `MAX_TOP_OF_MIND_ENTRIES` (7) entries, each
typed (`pattern`, `tension`, `question`, `hypothesis`, `action`), each
citing signal ids — or an explicit `noChange`.

The first supplied signal is the selected leading focus unless a human-kept
entry already leads. A saved event or workshop does not prove attendance,
completion or a repeated habit; the prompt preserves that distinction. These
are synthesis constraints, not new ranking weights or eligibility thresholds.

Whole-artifact on purpose: a model asked to patch entries reasons about
diffs it cannot see, and every incremental variant of this call drifted into
appending. Temperature 0, schema-constrained, everything user-originated
fenced as data.

**The language of the artifact.** Every entry is written in the profile's
`preferred_locale` (`en-US` or `ko-KR` — the person chooses at signup and can
change it on their profile). The locale line in the prompt is authoritative:
it governs even entries carried forward from the current artifact, so
flipping the setting re-speaks the whole top of mind in the new language on
the next refresh. Locked entries are the one exception — the person's own
words are reproduced exactly, whatever language they wrote them in. Signal
statements deliberately do NOT follow the setting: extraction writes them in
the language the capture itself was written in, because a signal quotes the
person's own vocabulary back to them.

### 4. What code enforces after the model answers

| Guarantee | Mechanism |
|---|---|
| Every cited signal exists and belongs to this profile | Citations validated against the DB; invented ones dropped; an entry left citing nothing is dropped with it. An artifact that cites nothing is a horoscope. |
| Locked entries survive **byte-identical** | Copied forward from storage, never from the model's reply — the model is asked to reproduce them and then not trusted to. Violations are counted and logged. |
| Pins, dismissals, locks survive regeneration | Columns on entries, carried by code; the model never sees or controls them. |
| "Nothing changed" is a decision, not a silence | A no-move/no-signal pass carries the support-projected reading, not withheld machine conclusions. It compares that result to stored entries; removing stale text or updating citations is a change even if the model reports `noChange`. |
| Stale generation cannot replace newer material | A per-profile revision is captured before input reads and locked/rechecked at commit, alongside the artifact-family lock and worker claim. Concurrent source, statement or human edits make generation retry. |
| Order-shuffled citations are not a change | The no-change comparison treats citations as a set. |
| Rejected content does not return | Entries whose latest verdict is `not_true` may not come back in the same form; corrections outrank model phrasing. |

Versions form a chain: the previous live artifact is marked superseded and
points at its replacement. Nothing is mutated in place; history is walkable.

Personal read projection checks **all** an entry's citations. Unkept generated
entries with lost support are withheld; locked/pinned words stay, explicitly
marked as changed support, without old generated explanations. These kept
entries remain available to synthesis as the person's choices, with no old
citations presented as support. Exact body-and-type matches may acquire fresh
validated citations without rewriting the words. Unsupported machine entries
also stay out of the personal principle generator's current-reading context.
The check is standing/ownership, not a new semantic-quality threshold. Pending
source/statement reassessment and potentially contaminated legacy context still
need separate handling; these projections do not certify that work complete.

### 5. The group's top of mind — retired

Rooms left the product on 2026-10-15 and their engine on 2026-10-17
(phase 1 of the retirement: code only, no migration). `refreshTopOfMindForGroup`,
the room derivation pass (`deriveIntoProfileId`), room principles and room
support review are deleted, and nothing enqueues room work. A
`refresh_group_top_of_mind` job — or any other room-shaped job — already in
the queue is settled by the worker without running (`retiredGroupJob` in
`packages/api/src/lib/queue.ts`); the enum value stays until a migration
removes it. The room tables and their rows are kept, unregenerated, pending a
drop decision; see `docs/map.md`. The thresholds that gated a room's first
draft (`GROUP_DRAFT_*`) and a room signal's serving
(`GROUP_SIGNAL_MIN_VOICES`) went with it.

---

## The gardener: the standing set, revisited

Matching happens at candidate time and never again — so two standing
signals that name one pattern (minted on different days as the wording
drifted, or minted as siblings while the judge was unreachable) would
coexist forever, splitting their evidence. Once a week per profile
(enqueued nightly beside the principles cron, keyed per ISO week), the
gardener looks:

- **Scan**: pairwise cosine in process over the stored vectors of up to
  `GARDENER_SCAN_LIMIT` most-recently-evidenced active and emerging
  signals. Suspects are pairs at or above `GARDENER_SUSPECT_MIN_COSINE` —
  the attach threshold itself, so only pairs derivation would already call
  the same pattern.
- **Judge**: at most `GARDENER_MAX_JUDGED_PAIRS` per pass, strongest
  first, with the same austere judge derivation uses. Pairs already on the
  record — a proposal in any state, or a contradiction — are never asked
  about again.
- **Record, never act**: `same` writes an unresolved `signal_duplicates`
  row — a PROPOSAL; `opposed` writes the same contradiction row a
  capture-time opposition writes; `independent` writes nothing.

All comparison calls finish before the batch transaction starts. A failed
later call cannot leave earlier proposals persisted. The final transaction
checks the input revision and worker claim, acquires non-waiting statement
locks, and rechecks recorded pairs. A keep-apart decision arriving during a
call wins over that late verdict; a concurrent human edit makes the pass retry.

**The merge is the owner's act** (`POST /api/signal-duplicates/:id/resolve`,
human sessions only — the world never moves unless the user moved it, and a
merge moves their memory):

- `merge` — the survivor is the locked side if exactly one side is locked
  (the person's own words always win), otherwise the elder. The survivor
  gains an evidence link for every inspiration the other side witnessed
  that it lacked; the other side **retires** keeping its statement, its
  history, and its own evidence links — retirement is provenance, never a
  half-delete — and the proposal records the survivor in
  `merged_into_signal_id`. Top-of-mind and principle citations repoint.
  The survivor's confidence recomputes from its widened evidence.
- `keep_apart` — a standing answer the gardener respects forever.

---

## When the model fails

Dev recovery additionally checks known overdue work every fifteen minutes,
using the existing claim and budget path with five-minute grace and at most
five claims in one pass. Scheduled cadence/budget waits and active leases are
excluded. The daily sweep stays in place and production's cadence is unchanged.
Recovery never creates a second job or resets its attempt budget; ambiguous
conversation dispatches retain their existing refusal-to-redispatch guard.
Exhausted stale leases raise operational counts instead of being revived.

The claim rechecks the runnable predicate on its locked base row and update
target, not only the earlier fairness-ranking snapshot. A row that another
worker completed, claimed, deferred or exhausted in that interval is not taken.
Saved reflection/review questions are reused on missed settlement only when
their owned context, output format and citations still validate. These guards
prevent those duplicate purchases; they do not promise exactly-once billing
when a provider response is lost before any result was saved.

Model transport metrics record attempted requests and available token metadata,
plus returned OpenRouter charges. They contain no source words or response
content. Missing cost and Gemini dollar costs are explicitly unpriced; metrics
do not turn hourly job/call allowances into a hard monetary cap. Deployed
per-environment cap and notification verification remain separate acceptance.

Two absences, told apart at the transport and never conflated again
(2026-08-31; before this, both were recorded as the safe verdict — a failed
extraction became "this capture teaches nothing" forever, and a failed judge
minted a duplicate signal):

- **The model declined** — a safety block, a content filter. Terminal:
  retrying the same material would be refused again, so callers keep their
  safe postures (extraction: no candidates; the judges: independent).
- **The road failed** — timeout, truncation, malformed envelope. The task
  throws, the job attempt fails, and the queue retries up to its
  `max_attempts`; an exhausted job parks as `failed`, visible and
  re-runnable. Derivation is safe to retry by construction: evidence is
  unique per (signal, inspiration), and a re-extracted statement lands in
  the dedupe band of anything the earlier attempt already minted.

Whole-artifact synthesis and declaration routing throw on **both** absences
— an artifact must never record a decision the model did not make.

---

## How time is applied

**Evidence is dated by the capture that witnesses it** — `inspirations
.created_at`, never the evidence row's own insert time. The two diverge
exactly when it matters: an old save cited retroactively arrives carrying
its own date, so it widens the spread term instead of collapsing it and
cannot masquerade as fresh recency. Confidence, selection, the principle
span bar, and the read routes all apply this one rule.

Four terms read the clock; nothing else does. What matters is *when* each is
evaluated — a decay term only exists if something actually runs it.

| Term | Shape | Evaluated |
|---|---|---|
| Confidence recency (weight 15) | half-life `CONFIDENCE_RECENCY_HALF_LIFE_DAYS` (45) since the newest evidence | Live, at every personal read and every selection **[checked]** |
| Confidence spread (weight 30) | span of evidence, saturating at `CONFIDENCE_SATURATION_SPREAD_DAYS` (30) | Same — but monotonic: spread never shrinks as time passes |
| Selection recency (weight 0.2) | half-life `SELECTION_RECENCY_HALF_LIFE_DAYS` (30) since last evidence | Live, at every refresh |
| Comeback bonus (weight 0.15) | needs a gap ≥ `COMEBACK_MIN_DORMANT_DAYS` (21); the return must be ≤ `COMEBACK_MAX_RETURN_AGE_DAYS` (14) old | Live, at every refresh |

So a signal decays twice, on different clocks: its **confidence** fades with
a 45-day half-life, and its **selection score** fades again with a 30-day
half-life. Both are computed from the evidence timestamps at the moment of
the read — no cron rewrites scores, and a profile nobody touches costs
nothing. The stored snapshot does *not* decay, which is exactly why no
personal surface serves it.

Deliberate consequences:

- **Silence is information.** A quiet signal sinks in both confidence and
  selection, making room without anyone dismissing anything.
- **Scores floor rather than vanish.** Support and spread do not decay, so a
  well-evidenced dormant signal settles low-but-nonzero — reachable the
  moment fresh evidence or a comeback lands, never deleted by arithmetic.
- **Returns beat persistence.** The comeback bonus pays for a gap plus a
  recent return; a comeback not acted on within two weeks is just history.

---

## Layer 4: principles — how the person chooses

Implemented per `docs/goals/principles.md` (2026-08-18 → 2026-08-21). The
constants live in `packages/api/src/lib/principle-generation.ts` and are
drift-locked like every other table here.

A **principle** is how a person chooses, stripped of context — the generator
from which context-bound **rules** compile ("frugal mindset" → "≤$100 for
LLM testing" under the context *LLM testing*). WAKA stores the generator;
captured rules are evidence, never artifacts. Unlike top of mind (ONE
bounded artifact, rewritten whole, decaying by design), principles are a
**growing, uncapped set** selected by *longevity* — what survives is what
qualifies.

**Five qualification tests, all required for a minted principle:**

1. **Context** — still instructs after every proper noun, number, and
   project name is deleted; otherwise it is a rule → evidence.
2. **Directive** — prescribes the next choice; a fact about the person is a
   signal, not a principle.
3. **Evidence** — cites at least `PRINCIPLE_MIN_SIGNALS` (3) distinct
   signals with distinct statements from this profile's own history; duplicate
   wording under multiple IDs does not clear the count. Uncited virtue is a
   horoscope.
4. **Support** — evidence spanning at least `PRINCIPLE_MIN_SPAN_DAYS` (0)
   days and selected into at least `PRINCIPLE_MIN_TOM_APPEARANCES` (1)
   top-of-mind versions. Both computed over the UNION of the citing signals — the
   theme's lifetime, not any one wording's. **[checked]**
5. **Completion** — can never be finished; anything checkable-off is a
   goal, not a principle.

Tests 3 and 4 are hard numbers checked in SQL; tests 1, 2, and 5 are
semantic properties no formula can check, applied by the model under
instruction. Matching the current reading's theme is allowed: a Principle
guides the next choice rather than describing current attention. Capture dates
alone do not impose a calendar wait; explicit cross-context choices still need
current, distinct supporting statements. Temporary intentions and saved external
opinions do not become timeless directives.
Same-day captures can describe choices made across different contexts; their
save dates alone do not prove the experiences happened on one day. Conversely,
multiple statements from one originating event do not establish independent
choices. Distillation distinguishes those cases before semantic grounding.

Before matching/publication, structurally eligible generated candidates receive
one semantic grounding batch against only their cited statements. Its limits
are three candidates, 48 statements, 18,000 characters and 512 output tokens.
Every candidate must receive exactly one boolean verdict; a missing, duplicated,
foreign, malformed or declined answer retries rather than accepting the claim.
An unsupported verdict drops the candidate without touching standing human
words. The extra step is cached, revision/lease fenced and charged to the same
four-calls-per-pass/40-per-account-hour ledger. Both providers preserve their
request builders' output-token limits. A model check reduces risk, not a proof
against all possible semantic errors; the fixed live calibration is separately
reviewed. Owner **declarations** skip evidence and time (aspirational
until demonstrated); context, directive, and completion still apply
internally, and a declaration failing them is quietly kept as an
inspiration — evidence, where it belongs — with no refusal surfaced.

**States:** `held` (demonstrated), `aspirational` (declared, visibly
undemonstrated; redeemed to held when evidence arrives), `contested` (the
owner's `not_true` verdict, or a judged conflict between two principles,
marked as a pair for owner adjudication). An explicit, owner-reorderable
**rank** keeps the set decidable even while a conflict stands — the higher
rank wins operationally.

Loss of evidence never deletes a human-edited principle, including one that
was originally minted. `unsupported_at` records the loss independently of
disagreement: an unopposed preserved row becomes aspirational, while contested
rows retain their dispute. The JSON, UI, and canonical machine rendering
disclose withdrawn support. Qualifying evidence can clear that mark and
restore demonstrated standing without changing the person's words or deciding
an open dispute. Only unedited machine-owned principles are removed by this
reconciliation.

**Generation is mint-or-match, when material changes.** A completed personal
or room top-of-mind pass requests an eligibility check. Opening principles
can request missing work through a POST; GETs only read. The nightly cron
(08:00 UTC) and local hourly pass recover missed work. All paths share a
material fingerprint, so completed inputs are not regenerated on page opens.
An unchanged reading (`no_change`) retains its audit row but counts as the
preceding meaningful version for Principle appearances and work identity.
Support is still checked on the actual cited row, so refreshed citations do
not disappear merely because the reading's words stayed the same. Meaningful
reading changes, signal wording/evidence timestamps and locale changes still
participate in the fingerprint; no historical rows are rewritten. Personal
fingerprints also include current inspiration revisions and validated review
material identities. These cover reflection/media edits and corrected review
answers even when capture dates remain unchanged. Repeated support-check
timestamps are excluded. This strengthens personal work identity to
`principles-v4` for personal work (group work is `principles-v3`, retaining
its public-statement-only inputs). The policy bump includes the new distinct
wording and semantic-grounding checks so an old completed empty result cannot
permanently suppress them. An eligible profile can get one fresh pass under the new key
when the normal scheduling path next runs, not from a GET or a data repair.
Failed jobs retry only within the worker budget or by an explicit retry.
The work fingerprint also binds the actual rendered distillation context,
including its framing, so a prompt-header change cannot reuse an obsolete
completed step. No cadence, hourly allowance or dispatch limit changes.
Each request evaluates the active profile: one cheap SQL check for clusters
newly past the bar, and only then model calls (distill at most
`PRINCIPLE_MAX_CANDIDATES_PER_RUN` (3) candidates; judge each against the
standing set in batches of at most 20 as `same | independent | conflicting`, conservative toward
independent — the same recoverable-mistake stance as match-or-mint, one
level up). Statements are capped at `PRINCIPLE_MAX_STATEMENT_LENGTH` (200)
characters: a principle is a directive, not an essay. State maintenance
(contested flips, reconciliation after evidence loss) is immediate SQL and
does not wait for midnight. Rooms use their own signals and top-of-mind
versions. Every room signal must still pass the wall's current-member and
visibility checks; principle reads expose only those signal statements.

Distillation input is separately bounded: at most 48 signals, 24 standing
Principles as advisory context, seven current entries and 16,000 serialized
context characters. Current reading signals get up to half the signal space;
established evidence fills the remainder. Whole items are omitted to fit, never
rewritten or truncated. The provider boundary rejects oversized inputs. The
24-item standing-context limit does not remove any Principle from the subsequent
comparison set.
Each comparison request is capped at 12,000 context characters and 1,600 output
tokens. It must return exactly one verdict for every supplied ID; missing,
duplicate, foreign or malformed results fail the batch rather than silently
becoming `independent`. Genuine semantic uncertainty may still be judged
independent. The complete candidate plan is validated before any Principle is
written, including comparisons against earlier provisional candidates.
Generation yields after at most four model calls per worker pass and resumes
from private `principle_generation_steps` receipts. The account allowance is
40 actual Principle model dispatches per hour across its profiles; failed calls
remain counted when the queue returns an attempt. A current pending dispatch
blocks duplicate work for ten minutes. Completed responses are reused, and
provisional IDs are deterministic for the input snapshot. Changed evidence,
standing wording, locale, prompts or model configuration invalidate that
snapshot. Unchanged reading audits do not. Publication and its completion
receipt commit together, so a reclaimed job returns the prior result without
restoring words edited later. Obsolete response bodies are cleared; recent
billing receipts remain. These processing rows are separate from memory and
are removed on profile erasure. Migration 0066 is required before rollout.

**The canonical rendering is machine-facing:** one deterministic markdown
document (rank-ordered, stable ids, a preamble carrying the consumption
contract, contested pairs cross-referenced), served byte-identically via
`GET /api/principles.md` and the MCP tool — the web view is the human's
decorated reading of the same document. Golden-tested byte-for-byte.

The audit chain stays unbroken: answer → principle → signals → the person's
own captures — and decisions made by agents cite principle ids, extending it
to the last mile.

---

## Tuning constants

The authoritative values. Machine-checked against code — see
`packages/api/src/lib/generation-doc.test.ts`.

### Layer 2 — derivation (`packages/api/src/lib/signal-derivation-thresholds.ts`)

| Constant | Value | One line |
|---|---|---|
| `SIGNAL_MATCH_MIN_COSINE` | 0.86 | At or above: attach as evidence |
| `SIGNAL_MERGE_JUDGE_MIN_COSINE` | 0.7 | Band floor: ask the judge instead of minting blind |
| `SIGNAL_SUPPRESSION_MIN_COSINE` | 0.86 | At or above a dismissed signal's vector: refuse the candidate, on the record |
| `SIGNAL_BATCH_DEDUPE_MIN_COSINE` | 0.94 | Within one extraction batch, collapse near-identical candidates |
| `SIGNAL_PROMOTION_MIN_EVIDENCE` | 3 | Evidence count where emerging becomes active |
| `GARDENER_SUSPECT_MIN_COSINE` | 0.86 | Two STANDING signals this close are worth a judge's minute |
| `GARDENER_SCAN_LIMIT` | 300 | Most-recently-evidenced signals one garden pass reads |
| `GARDENER_MAX_JUDGED_PAIRS` | 8 | Judge calls one pass may spend; the rest wait a week |
| `CONFIDENCE_SUPPORT_WEIGHT` | 55 | Confidence: weight of evidence count |
| `CONFIDENCE_SPREAD_WEIGHT` | 30 | Confidence: weight of time spread |
| `CONFIDENCE_RECENCY_WEIGHT` | 15 | Confidence: weight of recency |
| `CONFIDENCE_SATURATION_EVIDENCE` | 6 | Evidence count where support saturates |
| `CONFIDENCE_SATURATION_SPREAD_DAYS` | 30 | Spread saturates at this many days |
| `CONFIDENCE_RECENCY_HALF_LIFE_DAYS` | 45 | Recency half-life |
| `CONFIDENCE_SOURCE_DIVERSITY_BONUS` | 8 | Added when app and agent evidence corroborate |
| `CONFIDENCE_AFFIRMED_BONUS` | 30 | Added when the owner's latest verdict on the signal is "true". Borrowed from `CONFIDENCE_SPREAD_WEIGHT`: saying "this is me" is worth what a month of recurrence is worth. Was 8 — the same as the source-diversity bonus — which reached selection as +3.6 of 100 against the -36 that rejecting the same claim produced |
| `MATCH_CANDIDATE_SCAN_LIMIT` | 500 | Most-recently-evidenced signals scanned per match |
| `RELATED_INSPIRATION_SCAN_LIMIT` | 500 | Most recent capture vectors scanned for relatedness |
| `RELATED_INSPIRATION_MIN_COSINE` | 0.6 | Floor below which an earlier capture is not offered as context |
| `RELATED_INSPIRATION_CONTEXT_LIMIT` | 5 | Related captures the extractor is shown, strongest first |
| `RECALL_MIN_COSINE` | 0.6 | Recall's floor — the relatedness floor derivation already trusts |
| `RECALL_LIMIT` | 8 | Most matches one recall serves; an answer, not a dump |

### Layer 3 — synthesis (`packages/api/src/lib/top-of-mind-synthesis.ts`)

| Constant | Value | One line |
|---|---|---|
| `TOP_OF_MIND_SIGNAL_LIMIT` | 12 | Signals synthesis may consider |
| `TOP_OF_MIND_MIN_SIGNALS` | 3 | Cold-start floor; below it, emerging signals backfill |
| `TOP_OF_MIND_FOCUS_LIMIT` | 3 | Bounded recent-focus allowance before stable background |
| `TOP_OF_MIND_FOCUS_DAYS` | 14 | Current-evidence window for that allowance |
| `TOP_OF_MIND_EMERGING_MIN_EVIDENCE` | 2 | Independent units required for emerging focus on established profiles |
| `TOP_OF_MIND_MIN_SHIFT_HOURS` | 24 | The board shifts at most once a day; an early automatic refresh sleeps until the floor opens |
| `SELECTION_CONFIDENCE_WEIGHT` | 0.45 | Selection: confidence term |
| `SELECTION_EVIDENCE_WEIGHT` | 0.2 | Selection: support term |
| `SELECTION_RECENCY_WEIGHT` | 0.2 | Selection: recency term |
| `SELECTION_COMEBACK_WEIGHT` | 0.15 | Selection: comeback term |
| `SELECTION_DISPUTED_MULTIPLIER` | 0.4 | Damping when the latest verdict is not_true |
| `SELECTION_DIVERSITY_MAX_COSINE` | 0.8 | Ranked near-duplicates yield their slot; empty slots stay empty |
| `SELECTION_EVIDENCE_SATURATION` | 6 | Support saturates at this evidence count |
| `SELECTION_RECENCY_HALF_LIFE_DAYS` | 30 | Selection recency half-life |
| `COMEBACK_MIN_DORMANT_DAYS` | 21 | Minimum gap for a return to count |
| `COMEBACK_SATURATION_DAYS` | 90 | Gap length where the bonus saturates |
| `COMEBACK_MAX_RETURN_AGE_DAYS` | 14 | A return older than this is just history |

### Layer 4 — principles (`packages/api/src/lib/principle-generation.ts`)

| Constant | Value | One line |
|---|---|---|
| `PRINCIPLE_MIN_SIGNALS` | 3 | Distinct citing signals a principle must rest on |
| `PRINCIPLE_MIN_SPAN_DAYS` | 0 | Initial principles require evidence, without a calendar wait |
| `PRINCIPLE_MIN_TOM_APPEARANCES` | 1 | Distinct top-of-mind versions citing the signals |
| `PRINCIPLE_MAX_STATEMENT_LENGTH` | 200 | A principle is a directive, not an essay |
| `PRINCIPLE_MAX_CANDIDATES_PER_RUN` | 3 | Candidates one nightly distillation may propose |

### Model calls (`packages/api/src/queue/gemini.ts`, `packages/api/src/lib/openrouter-http.ts`, `packages/api/src/lib/inspiration-embeddings.ts`)

Human signal edits and reverts persist vector replacement, reading work and
`review_signal_support` jobs with the statement transaction. Each review job
checks existing and previously withdrawn owned witnesses with the same bounded
support assessment used by derivation. It does not extract candidates or create
source-processing completion receipts. Its key is separate from `derive_signals`,
so an ordinary capture request cannot be replaced by support-only work.

Support decisions and citations bind monotonic statement/material/body
revisions. A source or wording change makes earlier proof non-current until
it is checked against the new inputs. Change-and-return cannot reuse a cached
old verdict. A positive evidence check does not certify an old artifact's
wording; a new synthesis supplies its own bindings. Human-edited words remain
with changed support, and their previous generated explanation is withheld.
Read workers wait for queued/running input checks before synthesis. Manual
reads can recover failed/missing reviews while active checks continue;
finished uncertainty preserves the words without an automatic retry loop.

Feedback is also revision-bound. A verdict applies to the signal/principle
statement or entry body it judged, not all future wording with that ID. Current
reaction markers, confidence and synthesis filter unmatched revisions; history
remains available to its reader. Personal feedback context additionally refuses
unsupported generated targets before its bounded limit, while explicitly held
entry words remain the person's words. Recording a verdict, immediate dispute
changes and required reading work is atomic. Deliberate personal corrections
request a manual reading rather than waiting for the passive daily floor;
room-only reactions request only the currently accessible room readings.
Room synthesis now consumes the latest current-word stances of current members,
deduplicated per member and signal before the context limit. It does not consume
their free-form correction text. Existing first-draft thresholds are unchanged.

Large sources use `assess_signal_support` jobs, each scoped to at most twelve
claims and one assessment call per attempt. The coordinator waits without
spending a retry while coverage is incomplete; actual provider failures retain
bounded retries and explicit recovery. Each batch binds the source material,
membership and statement revisions it was scheduled for. A stale batch makes
no provider call, and a partial report cannot apply verdicts outside its named
claims or claim full source completion. Discovery runs only after current
coverage is complete. Reading dependencies created by a batch attach to the
matching unfinished source receipts, without marking those receipts derived.

One prompt, two roads: generation defaults to DeepSeek V4.1 Flash on
OpenRouter when `OPENROUTER_API_KEY` is present, and falls back
to Gemini without it. Embeddings never switch roads — the stored vectors and
every cosine threshold above live in `gemini-embedding-001`'s space.

Top of Mind, Principles, signal extraction/support/judging, reflection,
Review questions/derivation, declaration routing, and Talk with WAKA all
default to `deepseek/deepseek-v4.1-flash`. Deployment configuration explicitly
sets `OPENROUTER_GENERATION_MODEL` for API and worker; dev also sets `WAKA_MODEL_CHAT` to the
same model. Deployment verification checks both. Per-task model overrides
remain available; no OpenRouter key still selects the Gemini provider rather
than interpreting an OpenRouter model ID as a direct Gemini model. The chat
switch does not enable production replies or change the 1,200-token output cap,
source validation, or request budget. Image descriptions and audio
transcription keep their direct Gemini models; changing those media clients
is not part of this text-generation switch.

| Constant | Value | One line |
|---|---|---|
| `OPENROUTER_GENERATION_MODEL` | deepseek/deepseek-v4.1-flash | All OpenRouter generation tasks — the default road |
| `OPENROUTER_MAX_OUTPUT_TOKENS` | 8192 | Bound on every answer — a small JSON artifact, never an essay; with reasoning declined, a truncated verdict cannot masquerade as "nothing here" |
| `OPENROUTER_CHAT_URL` | https://openrouter.ai/api/v1/chat/completions | The second road's endpoint |
| `GEMINI_GENERATION_MODEL` | gemini-3.1-flash-lite | Vision, and the whole road when no OpenRouter key is set |
| `GEMINI_EMBEDDING_MODEL` | gemini-embedding-001 | All vectors |
| `GEMINI_EMBEDDING_DIMENSIONS` | 768 | Vector width |
| `MAX_GEMINI_EMBEDDING_VALUES` | 4096 | Sanity ceiling on values accepted back per vector |
| `MAX_SIGNAL_CANDIDATES` | 3 | Statements one extraction may propose |
| `MAX_RELATED_INSPIRATION_CITATIONS` | 2 | Earlier captures one statement may cite as co-witnesses |
| `MAX_CATEGORY_CHARS` | 32 | A capture's own subject, in words — longer is a sentence, not a shelf |
| `MAX_EXISTING_CATEGORIES` | 24 | Shelves the reading is shown before it names a new one, busiest first |
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

A THIRD FLOOR LEFT THIS TABLE ON 2026-10-12. `FIELD_FLOOR_IN_GROUP` (0.1)
lifted a memory that was "out loud in a group" — a memory with a pattern
resting on it that had been shared into a room. The founder removed rooms
("방 없애"), `Signal.sharedGroupIds` went with the routes that computed it,
and nothing could set the flag true any more, so the constant and the term it
added to `colorBall` are both gone. Cited and answered are the two floors
there are. (`generation-doc.test.ts` is what noticed: it reads the exported
constants out of the code and fails on a table that names one the code does
not have, which is exactly the lie this table would otherwise have told.)

| Constant | Value | What it does |
| --- | --- | --- |
| `FIELD_DECAY_HALF_LIFE_DAYS` | 7 | Half-life of an untended memory's light |
| `FIELD_REFLECTION_SATURATION` | 2 | Attention stops adding light past this many reflections |
| `FIELD_REFLECTION_WEIGHT` | 0.25 | What each reflection adds, as a fraction of current decay |
| `FIELD_FLOOR_CITED` | 0.15 | A memory a signal rests on cannot sink below this |
| `FIELD_FLOOR_ANSWERED` | 0.18 | Nor one you answered in your own words |
| `FIELD_FRONTIER_DAYS` | 3 | Untouched longer than this and cited by nothing = a frontier |
| `BULB_FLOOR` | 0.12 | The dimmest the character burns — lit, never dark |
| `FIELD_CARRY_ROOT_SATURATION` | 3 | Roots stop adding carry past this many citing patterns |
| `FIELD_CARRY_ROOTS_SHARE` | 0.1 | Carry: the share held by how many patterns cite it |
| `FIELD_CARRY_PROMOTED_SHARE` | 0.45 | Carry: the share held by how far the pattern above it has got |
| `FIELD_CARRY_PROMOTION_EVIDENCE` | 3 | Evidence that fills the promotion share — the loop's own promote-at |
| `FIELD_CARRY_POSTER_SHARE` | 0.25 | Carry: the share held by reaching the live top of mind |
| `FIELD_CARRY_PRINCIPLE_SHARE` | 0.2 | Carry: the share held by reaching a principle |
| `FIELD_CARRY_SPAN` | 0.85 | Extra light a fully-carrying memory holds over a barely-cited one |
| `FIELD_ATTENTION_SPAN` | 0.16 | Extra floor for coming back to a memory, graded by how often |
| `FIELD_RECENCY_WEIGHT` | 0.25 | The share of the range freshness may spend; the rest belongs to use |

**The banding went with the orbs (2026-10-15).** While each memory was drawn
as an orb from a pre-baked sprite, the aliveness continuum was quantised into
bands — `TIERS`, nine of them, through `FIELD_TIER_CEILING` (1) and
`FIELD_TIER_GAMMA` (0.7), a curve because aliveness is exponential in age and
a linear banding spent nearly every band on the first week. The orbs are no
longer drawn, so the bands and both constants are gone; `alive` itself is
unchanged. The band arithmetic below is kept as the record of how the shares
were sized.

**Why promotion is the largest share, and why it grades.** Roots, the poster
and a principle are all the same number for every memory in a young archive:
nothing is adopted yet, no principles exist, and each capture derives its own
lone candidate — so every memory has exactly one root and the light has nothing
to say. Promotion is the one distinction that exists from the first week: a
signal turns `active` when three memories say the same thing, so a memory under
one is holding up something the loop has confirmed rather than a guess.

It was a BOOLEAN first, and that was the same failure one level down. `active`
is a cliff at three pieces of evidence, and a young archive lives entirely on
the near side of it — no signal has three memories behind it yet, so the term
was false for every memory and contributed exactly zero variance. Running the
real modules over this repo's own fixture: thirteen of fourteen cited memories,
spanning nine to ninety-one days, landed on the identical aliveness. So the
share grades toward the threshold instead of switching at it — one memory
behind the candidate is a guess, two is the loop starting to believe it, three
promotes and the term is full — and it is sized so that each of those steps
clears a whole band of `TIERS`. A share that buys less than a band is
arithmetic nobody can see, which is how four correct terms produced one flat
field.

**What the nine bands are spent on.** Measured through the real pipeline at
twenty days: uncited draws band 1; under one emerging candidate, 4; under a
candidate with two behind it, 5; under a promoted one, 6; reaching the live top
of mind, 7; and under a settled principle, 8. `FIELD_CARRY_ROOTS_SHARE` is
deliberately smaller than a band — how many patterns rest on a memory refines
its light WITHIN a band rather than moving it, because there are more
distinctions worth drawing than there are bands to draw them in, and how far
the loop has got with a memory beats how many times it has tried.

**Why the carry is graded and the floor is not.** `FIELD_FLOOR_CITED` is what
being cited AT ALL is worth: one root and nothing above it, and the memory can
no longer rot. `FIELD_CARRY_SPAN` is the range above that floor, spent by
`carryOf` on how far up the stack the memory actually reaches — roots, then
the poster, then a principle. Being cited stopped being a boolean the day the
field had to answer "how much of me is standing on this?" rather than "is
anything?". The three shares sum to one, so the carry is a clean 0–1 and the
spread it buys is the one named constant above rather than an emergent
maximum. It renders as light and never as a number: no badge, no count, no
bar — bright means load-bearing, dim means nothing rests here yet.

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

**Why freshness is added to the floors rather than raced against them.**
`colorBall` took `Math.max(recency, tended)` and that made age a dead channel
with a date on it. Freshness can only ever reach `FIELD_RECENCY_WEIGHT`; the
cited floor is already most of the way there; so past about five days the max
returned the floor and a cited memory's age CONTRIBUTED EXACTLY ZERO — forever,
for every cited memory in the archive. Now freshness spends its share of
whatever room is left above the floor: `tended + (1 - tended) * recency`. An
uncited memory is unaffected (its floor is nought, so it gets the whole share,
exactly as before); a memory that is cited, answered and out loud in a room has
less room to spend on being new, which is right, because by then what it holds
up matters more than when it arrived.

Age still saturates: with a seven-day half-life a memory three months old and
one a year old are both simply old, and the light says so. That is deliberate.
The founder's ask was that brightness track "how active this one is being used
to form signals, top of mind, and principle" — use is the meaning, and age is
the gradient underneath it.

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
