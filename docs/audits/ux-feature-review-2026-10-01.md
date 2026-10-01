# WAKA experience review and improvement plan

Date: 2026-10-01. Reviewed code: `33e65a7` on `dev`.
Revision 3: explicit bug-fixing workstream added to the reviewed delivery plan.
Status: proposed implementation plan; the audit and plan are the deliverable.

The strongest next investment is to make WAKA's learning visible, correctable,
and useful. The product already has a distinctive visual identity, saved
reflections, evidence-backed patterns, versioned top of mind, and principles.
Its largest gaps are in the connections between those features: an answer is
saved, but the resulting learning is difficult to see; a correction is
recorded, but old evidence can remain; a room invites participation, but does
not clearly show how that participation becomes a shared direction.

This plan preserves the dark field, companion, typography, and focused cards.
It adds clarity to actions, evidence, navigation, and outcomes. It also
identifies a few implementation defects that should be addressed before
changing generation thresholds or adding more features.

## Recommended next release

The next release should let a person **save a thought, reflect on it, change
their mind, and see an accurate result**. That is the release outcome. Search,
richer room participation, and generation tuning follow in independently
reviewable slices.

Start with three small changes that can be reviewed separately: native typing
and scrolling inside overlays; preservation of edited principles; and
account-scoped drafts and sharing preferences. In parallel with that work,
reproduce the room reflection exposure path and define its containment. Then
implement current-evidence reconciliation and accurate generation completion.
Do not bundle those changes into one migration or PR.

Bug fixing runs throughout all three releases. The workstream below turns
confirmed findings and new user reports into reproducible, verified fixes,
with a release gate for regressions in the affected journeys.

The first version of this plan had four weaknesses corrected here:

- It treated a bounded extraction's omissions as evidence to retract old
  support. Existing support needs its own explicit check.
- It described future-write fixes without a repair strategy for stored
  derivatives, historical views, caches, and jobs already in flight.
- It grouped unrelated work into large milestones, delaying small useful fixes.
- It introduced participation, drafting, and voting rules without defining a
  contribution round or how the existing first-draft gate would be replaced.

### Product constraints and decision defaults

| Topic | Status | Plan default |
| --- | --- | --- |
| Visual direction | Already requested | Keep the field, companion, restrained typography, focused cards, and existing overall feel. Make controls readable and predictable. |
| Shared direction UI | Already requested | Use existing room inspirations. One open contribution field; starters belong beside the explanation. No separate common-thread section or response categories. |
| Public states | Already requested | Keep one current reading. Present progress in one transient line and details on demand; technical queue states stay internal. |
| Member participation | Already requested; operational details proposed below | At least 50% of current members contribute to the next shared reading. Count people once per reading round. |
| Reflection sharing | Recommended policy requiring an explicit canon entry | Answers stay personal when the parent inspiration is public. Containment and an impact report precede any historical repair. |
| Edits and deletion | Existing ownership rule, implementation correction | Preserve user-edited words; invalidate their unsupported claims. Deleting an answer must also address retained quotes/copies, under the product's retention policy. |
| Update cadence | Current policy | Keep the 24-hour automatic floor initially. Fix its visibility and completion handling first; evaluate any later cadence change. |
| Principle maturity | Product hypothesis | Keep current thresholds for the baseline. Evaluate support independence and wording before selecting new thresholds. |
| Explicit room wording proposals | Current policy | Keep strict-majority acceptance for direct wording changes. Do not make it an additional approval step for every machine reading. |

These defaults make the plan implementable without presenting new policies as
already shipped. Changes to sharing, retention, or quorum semantics need a
concrete policy diff and examples in the relevant implementation review.

## Scope and evidence

- Read-only inspection of the authenticated dev app at `dev.waka.im`: personal
  home, top-of-mind disclosure, pattern feedback affordances, principle cards
  and evidence, room navigation, room contribution dialog, proposal composer,
  and mobile capture.
- Desktop review and a 390 × 844 responsive preview. The preview override was
  reset and the audit tab closed afterward.
- Source tracing of capture, reflection persistence and questions, signal
  derivation, matching and evidence, personal/group synthesis, principle
  generation and reconciliation, routing, storage, and relevant existing evals.
- No live inspirations, reflections, proposals, verdicts, or account settings
  were submitted. No live model evaluation was run. Existing account contents
  include examples from earlier testing; they are not a representative sample
  of real users' behavior.
- **Observed** below means reproduced in the live UI. **Code-backed** means
  the implementation establishes the path; a dedicated reproduction is still
  needed to establish its incidence or full downstream effect. **Product
  hypothesis** means a proposed improvement to validate with users.

This is an experience and generation review, not a full security assessment or
a claim of comprehensive accessibility conformance. Signup, password recovery,
destructive operations, multiple-account isolation, slow-provider behavior,
and large archives were inspected in code rather than exercised on the live
account. Production latency and engagement distributions were not measured.

## What is already worth keeping

- Captures, patterns, top of mind, and principles are separate records. The
  original inspiration remains editable and does not get overwritten by a
  generated summary.
- Reflection answers are saved before another question is requested. There is
  an explicit way to finish and a saved-reflection cue on personal orbs/cards.
- The model may return no pattern or no principle. This is an important
  defense against filling every screen with invented significance.
- Citation IDs and quoted spans are checked, signals deduplicate through
  matching, top of mind is versioned, and locks protect generated rewriting.
- Room signals need evidence from at least two current members. Proposals
  retain member stances and accepted changes create another reading.
- Principles already have a readable list, evidence examples, editing,
  ordering, disagreement, and a way to withdraw disagreement.
- Existing unit, database, browser, and live-model benches are a useful base.
  Extend them around the actual experience gaps rather than replacing them.

## Findings, ranked

P0 means resolve or contain before further exposure of the affected behavior.
P1 means the next product iteration. P2 means an experiment or improvement
scheduled after the core loop is reliable. Priority and evidence confidence
are separate: a P0 code path needs a minimal isolated reproduction before a
data-changing repair. These are proposed priorities, not measured incident
rates. F14/F16 are hypotheses to evaluate, not demonstrated algorithm defects.

| ID | Priority / evidence | Finding and user consequence |
| --- | --- | --- |
| F1 | P0 / code-backed | Editing or retracting a reflection can leave obsolete signal evidence and its original quote in place. WAKA can continue learning from something the person no longer says. |
| F2 | P0 / code-backed boundary risk | Derivation into a room reads reflection answers attached to a public inspiration. Those answers are not shown in the room field or separately shared. A room-generated statement could reveal private reflective context. |
| F3 | P0 / code-backed | A user-edited, originally generated principle can be automatically deleted when its supporting signals fall below the bar. Reconciliation considers origin and state but ignores the wording lock. |
| F4 | P0 before wider launch / code-backed | Capture drafts and remembered public/private choice use browser-wide keys, without account/profile scope. Switching accounts in the same browser can reveal another account's draft or inherit its sharing choice. |
| F5 | P1 / observed + code-backed | `/` inside a room proposal opens search and moves focus away. Global shortcuts run before the editable-target guard; reflection textareas have the same exposure. |
| F6 | P1 / observed + code-backed | Scrolling over the room dialog moves the world behind it. The wheel handler exempts inspiration cards and capture fields, but not room dialogs or the standalone reflection sheet. CSS overflow alone does not fix this. |
| F7 | P1 / code-backed | The personal poster can remain at its initial snapshot after newer top-of-mind data loads. Boot sets `adopted` from the fetched lead, and later absorption preserves that override. |
| F8 | P1 / code-backed | “Read it again” queues work, immediately reads the old artifact, then reports that the sky was redrawn. Queue acceptance is presented as generation completion. |
| F9 | P1 / code-backed | Capture checks top of mind once after six seconds; reflection callbacks update saved answers and orb light but do not follow downstream completion. Slow generation or a 24-hour hold can look like no learning occurred. |
| F10 | P1 / observed | Some active controls remain difficult to see. The principle disagreement button was 13px, 44px tall, with approximately 2.45:1 text contrast from computed colors. Target size improved, but visibility still falls short. |
| F11 | P1 / observed + code-backed | Finding an inspiration depends on opening unlabeled orbs or discovering `/`. Search highlights in place but does not offer recognizable results; a request failure is treated as “nothing found.” |
| F12 | P1 / code-backed | Wall changes use `replaceState`. Back does not traverse visited rooms; names become route identities, so duplicate names or renames can make links ambiguous. Inspiration, reflection, and view state are not addressable. |
| F13 | P1 / code-backed | Link attachment finalization and image upload failures are swallowed. A capture can appear saved while the content that would teach WAKA never arrived. Images also require a later edit rather than a clear initial capture path. |
| F14 | P1 / algorithm policy | Principles need three active signals and one top-of-mind appearance, with zero minimum time span. That permits an initial reading but does not establish a lasting principle or independent situations by itself. |
| F15 | P1 / observed + code-backed | “Shape this together” mostly opens an empty proposal composer and an activity list. It lacks grounded starters, clear quorum progress, and a connection from discussion to the next reading. |
| F16 | P2 / code-backed + product hypothesis | The model produces up to seven typed top-of-mind entries, while the main view privileges one lead. The remaining questions, tensions, and possible actions are hard to discover or use. |
| F17 | P1 before wider launch / code-backed | Password recovery is still unavailable. Google with the same verified email is a partial workaround, not recovery for every account. |
| F18 | P2 / code-backed scaling risk | Initial inspiration loading walks up to ten sequential pages before returning, then prefetches every loaded detail four at a time. A large archive can incur up to 2,000 detail requests, plus pattern reads and rendering work. |
| F19 | P2 / code-backed | Product policy documentation contradicts itself: reflection generation is still called parked, some sections say rooms have no principles, and old signal-sharing descriptions remain beside the pooled-public-inspiration model. This makes later UX and privacy work error-prone. |

### F1: current evidence and historical evidence need different roles

`signal-match-or-mint.ts::attachEvidence` uses `onConflictDoNothing`, deliberately
keeping the first reason and quote for a signal/inspiration pair. Derivation
adds current candidates but does not reconcile links that are no longer
supported. Its zero-candidate path returns before any removal. Reflection
deletion requests another derivation, but that alone does not retract the old
support.

Extraction proposes at most three candidates. A successful pass is not an
exhaustive inventory of all supported patterns. Absence from that result,
including a zero-candidate result, is therefore insufficient evidence for
deleting an existing support link.

Design the correction around these separate operations:

1. Give each derivation an immutable description of the material it read:
   capture revision, reflection IDs/revisions, attachment revisions, scope,
   and relevant policy version. An inspiration's `updatedAt` alone cannot
   identify reflection additions/deletions. Reuse the existing canonical
   input/hash machinery where practical; this does not require converting the
   whole app to event sourcing.
2. Track exact supporting source references. A quoted answer must identify
   its reflection, not only its parent inspiration. When the named source is
   deleted or its quote changes, that exact citation stops being current.
3. Check previously linked claims explicitly against the remaining current
   material, alongside bounded discovery of new candidates. Keep supported
   links, withdraw explicitly unsupported links, and treat uncertain or
   unavailable checks as unresolved. Never convert provider failure or
   extraction omission into negative evidence.
4. Immediately before committing, recheck the material revision, access scope,
   membership, and human edits. Discard an outdated result and queue the
   latest material. An advisory lock taken after a model call does not by
   itself prevent an old result from overwriting a newer interpretation.
5. Update affected support and downstream standing atomically where possible,
   using a durable handoff for additional jobs. Preserve edited words while
   marking them unsupported; recompute generated dependents from valid inputs.

Revision history is useful for edits, but deleted text must not survive by
accident in quotes, question-job payloads, drafts, or historical views. Define
retention and purge/redaction behavior before adding snapshots. A deletion
audit can retain appropriate identifiers and outcome metadata without keeping
the deleted answer body. Restoring support after a mistaken withdrawal should
be possible when the underlying source still exists.

Acceptance: deleted source quotations are no longer served as current
evidence; a check of remaining material determines whether the broader claim
still stands; unchanged material survives an extractor omitting it; old jobs
cannot restore withdrawn content; locked wording survives. Measure recovery
from false withdrawals as well as removal of stale support.

Sources: `packages/api/src/lib/signal-derivation.ts`,
`packages/api/src/lib/signal-match-or-mint.ts`,
`packages/api/src/routes/inspirations-reflections.ts`,
`packages/api/src/lib/signal-lifecycle.ts`.

### F2: decide reflection sharing explicitly

`requestSignalDerivation` fans public inspirations out to room minds. The room
pass in `deriveSignalsForInspiration` loads the same reflection answers as a
personal pass and supplies them to extraction. The room field exposes the
inspiration text, not its reflective answers. The personal field marker also
deliberately treats reflection state as private.

This is a code-backed exposure path; the audit did not demonstrate an actual
private answer appearing in live room output. It deserves an isolated test
before treating the sharing boundary as safe.

Recommended default: personal reflections remain personal even when their
parent inspiration is public. Room derivation should read only material the
room is entitled to see. If sharing a reflection becomes a feature later,
publish a clearly chosen excerpt with an explicit preview and provenance.
Define the policy in the canon before implementing any new sharing field.

Filtering only the reflection array is insufficient. Inspiration embeddings
also include answers and are reused by the room path for related-material
retrieval. Existing room signals are supplied as phrasing context and can
carry earlier reflective content forward. Define a room-safe projection for
extraction, retrieval vectors, existing-statement context, matching, evidence,
and synthesis. Recheck visibility and membership at commit time as well as
when a job starts.

Contain future exposure first. Then produce a read-only impact report for
stored room signals, readings, principles, cached results, and historical
views that may have depended on reflective content. Where lineage is
incomplete, report the uncertainty and conservative review scope. Repair only
named, reviewed batches; restrict potentially unsafe serving while rebuilding
from allowed inputs. Do not erase all room history or overwrite human edits
as an automatic cleanup step. A safe input filter alone does not prove old
output has been repaired.

Acceptance: a sentinel present only in a private reflection cannot enter a
room's prompts or served output, including historical views. With public
material held constant, private-answer edits must not alter the room's
retrieval inputs or generated meaning. Publishing the parent inspiration does
not change that. Test leave/join, visibility changes during model execution,
and replay of pre-fix jobs. Passing sentinel tests establishes regression
coverage, not proof that every historical derivative is free of private data.

Sources: `packages/api/src/routes/inspirations-derivation.ts`,
`packages/api/src/lib/signal-derivation.ts`,
`packages/api/src/lib/inspiration-embeddings.ts`,
`packages/api/src/routes/groups-field.ts`, `docs/data-model.md`.

### F3–F4: ownership must survive evidence changes and browser reuse

Principle editing sets `lockedAt` while preserving `origin: minted`.
`reconcileAction` can return `remove` for that row without considering the
lock; the loss handler then deletes it. Preserve the person's wording and
record lost support instead. Preserving text must not keep presenting it as a
machine-supported principle: UI and machine-facing reads must agree on its
standing. Reuse existing standing concepts if adequate; any schema extension
must first be specified in the canon. The machine must not silently delete
their edit. Losing evidence does not establish that the person's statement
is false or withdraw their instruction; distinguish lost support from a
human disagreement.

Scope drafts and capture preferences to account/profile identity. Keep a
person's unfinished text recoverable for that person, while another account
on the same browser starts with its own draft and sharing preference. Decide
how to handle the old unscoped draft rather than silently assigning it to the
next signed-in account. Until ownership can be established, keep that old
draft outside another account's rendered capture flow; do not delete it or
auto-import it into the next profile. An account switch must also cancel
in-flight reads and clear in-memory material from the previous account.

Acceptance: edited principles survive the loss of every citation; two test
accounts on one browser cannot see each other's unfinished text or inherit
each other's public choice.

Sources: `packages/api/src/lib/principle-generation.ts::reconcileAction`,
`packages/api/src/routes/principles.ts`, `packages/web/src/pages/Home.tsx`
draft/`keepPublic` initialization, `packages/web/src/lib/auth-context.tsx`.

### F5–F10: make input, completion, and readability dependable

Use a common interaction boundary for every overlay. Inputs own their
characters and caret keys; scrollable panels own their wheel/touch scrolling;
the topmost overlay owns Escape, focus, and dismissal. The global `/` handler
currently runs ahead of the editable-target guard. The wheel exemption only
recognizes `.jar-panel`, `.jar-mouth`, and `.jar-mouth-slot--note`.

For top of mind, keep one authoritative artifact snapshot and derive the
displayed lead from it. Reserve a human override for an actual human choice,
not a copy seeded at boot. A refresh API returns a job identifier: the UI
should follow that job/material revision and distinguish queued work,
completed changed output, completed unchanged output, and failure internally.

Keep the public experience simple: retain the current reading, show one brief
line when new material is being considered, and offer a retry when attention
is required. If the daily floor holds, say when the next reading is expected.
Only report a new reading after it exists. Finishing a reflection should have
the same route to downstream completion as saving an inspiration.

Define one completion contract before building these receipts. The server
must identify the requested material revision, the latest completed revision,
the resulting artifact version, whether content changed, and whether work is
still eligible to run. Following a recycled/coalesced job ID alone must not
let completion of an older capture acknowledge a newer answer.

| Situation | What the person sees | Required behavior |
| --- | --- | --- |
| Answer saved; generation still running | “Your thought is kept” and a brief reading-in-progress line | Saving succeeds independently. Keep the current reading readable. |
| Automatic read held by cadence | One line giving the earliest eligible read time | Do not promise that provider work will finish at that exact time. Manual reread may bypass cadence but still respects service limits. |
| New content is ready | The completed result for an explicit reread; otherwise a concise “See what changed” action | Show current versus previous wording with supporting sources. Avoid moving the scene or replacing text while the person is typing or reading another panel. |
| Completed with no content change | Brief confirmation that the current reading still holds | Clear progress; do not animate a fabricated change or call it a failure. |
| Generation failed or is taking longer | Keep saved text and the previous valid reading; offer one relevant recovery action | A timeout is not proof of terminal failure. Resume watching existing work before creating another request. |

These are rules for one status line, not five persistent product badges.
Observe status only while relevant, with backoff and cancellation on account
change/unmount. Start with the reflection and top-of-mind paths, reusing the
existing principle status pattern where useful. Durable enqueue/recovery must
cover a committed save whose downstream job could not be scheduled.

Make active evidence/correction controls readable at rest. The measured
principle control has enough height; increase text contrast rather than
blanket-resizing the composition. Its approximately 2.45:1 contrast is below
the 4.5:1 normal-text target in
[WCAG's contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
Use the existing 44px touch targets for repeated primary actions; the
[WCAG minimum target criterion](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
also has spacing and other exceptions, so avoid describing every smaller
control as automatically nonconforming.

Acceptance: `/` can be typed in every text field; dialog scrolling leaves the
background still; tab focus stays with the current interaction and returns
when it closes; a queued refresh never displays a completion receipt; the
poster matches the fetched live artifact after a completed update; active
text controls meet the contrast target.

Sources: `Home.tsx` global `onKey`/`onWheel`, `rebuildBoard`, `absorbBoard`,
`reflectionSaved`; `space/top-of-mind/board.ts::deriveAmbition`;
`routes/top-of-mind.ts` refresh response; `styles/home.css` control colors.

## The current algorithms, in user terms

| Layer | What actually drives it | What the experience should communicate |
| --- | --- | --- |
| Inspiration / reflection | An editable capture plus separate saved Q&A rows. Each answer can request another derivation. Multiple answers on the same inspiration do not create independent capture evidence. | “Your answer is kept. WAKA can use it to better understand why this mattered.” Give a path back to the exact answer. |
| Personal pattern | The extractor proposes 0–3 statements from capture, answers, attachments, and up to five related captures. Matching attaches at cosine ≥0.86, asks a judge from 0.70 to 0.86, otherwise mints. Three inspiration-evidence rows promote a pattern to active. | Repeated evidence matters more than the number of questions answered. A quote of an idea is not automatically a preference or a choice. |
| Personal top of mind | Up to 12 selected signals; weights are confidence 0.45, evidence 0.20, recency 0.20, comeback 0.15. Cold start can borrow emerging signals when fewer than three active signals exist. The model writes up to seven entries. Automatic content shifts have a 24-hour floor; manual reads bypass it. | “What seems current” and “what has held for a while” need different wording. New material can be queued while the current reading stays stable. |
| Principle | Each candidate needs at least three active, evidenced signals, collective citation in at least one top-of-mind version, and zero minimum time span. The model proposes up to three directives; a judge compares them with standing principles. | The threshold makes an initial reading possible. It does not, by itself, demonstrate a durable personal rule. |
| Room pattern | Generated over public inspirations; a visible room signal must have evidence from at least two current members. | A shared reading should say who supports it and what common public material it rests on. It must not imply every member agrees. |
| First room draft | Requires two affirmed signals in rooms of up to three members, otherwise three. This counts affirmed signals, not distinct participating members. | Evidence breadth, member participation, and approval are different facts. |
| Room proposal | The proposer counts as an affirmation. Acceptance requires strictly more than half of current members: `affirmations × 2 > members`. | Show an explicit member tally and how many more agreements are needed. A contribution is not necessarily an approval. |

Numbers verified against `docs/generation.md` and the current implementation.
The table describes policy, not measured model accuracy.

### Improve generation through evaluation before retuning numbers

1. **Preserve the type of evidence.** Distinguish an admired idea, a stated
   preference, an intended action, and an observed choice in extraction input
   and evidence. Use the distinction to calibrate wording, not to burden the
   capture UI with another classification form.
2. **Preserve the origin of evidence.** A quote from an answer should point to
   that reflection/turn and its revision. Today own text combines the original
   capture and answers, then stores the quote on the inspiration's evidence
   row. A reader cannot reliably tell which answer supplied it. “Why this
   fits” also reads original inspiration examples rather than reflective
   passages.
3. **Distinguish independence from volume.** Three signals can share the same
   captures. Adding many answers to one note should deepen understanding,
   not manufacture recurrence. Count independent captures/situations and
   shared-source concentration when evaluating principle strength.
4. **Let new interests compete in an established profile.** Once there are
   three active signals, emerging ones no longer enter selection. Evaluate a
   small reserved opportunity for recent exploratory material so old durable
   themes do not indefinitely crowd out a new current interest. Keep tentative
   wording and a low cap.
5. **Respect correction promptly.** A feedback-triggered refresh currently
   uses `signals_changed`, which can hit the daily floor. Separate deliberate
   correction from passive new material. Immediate standing should reflect
   disagreement even when a new generated reading is still pending.
6. **Keep principles distinct from top of mind.** Evaluate independent
   situations, repeated choices, survival, contradictory evidence, and
   semantic overlap with the current reading. Retain early usefulness with
   calibrated language and explanations; avoid introducing a large set of
   public maturity states. Choose exact evidence thresholds from results.
7. **Check supported meaning, not just valid IDs.** Valid citation IDs and
   verbatim quotes do not prove that the quote entails the conclusion. Add
   adversarial examples and human review for overgeneralization, repetition,
   invented certainty, and inappropriate directives.
8. **Separate renewed attention from independent evidence.** Selection dates
   evidence by the original inspiration's capture time. Evaluate whether a
   meaningful reflection on an old inspiration should refresh its topical
   relevance without increasing the number of independent witnesses. A new
   insight today should not automatically look months old, and repeated
   answers should not manufacture recurrence.

The existing extraction bench has 16 cases with empty reflection inputs; it
tests topic coverage, abstention, language, and meta-reference. The live
pipeline bench proves machinery and the daily floor, not the usefulness of
the resulting reading. Extend these with reflection, retraction, longitudinal
change, principles, and room-specific cases. Do not substitute a prompt edit
for a measurement.

## Product and feature improvements

### Capture and recall

Give the field a visible “Find inspiration” control. Open a compact search
surface with recognizable text/title, date, and reflection cue, with a tap
opening the existing card. Keep the spatial field as the default. Search
should distinguish loading, no matches, and failure; it should return relevant
material even if that material lies outside the initially loaded field.

Make links and images first-class in the same capture flow: paste/drop/select,
preview what will be kept, then save. Show which part landed and which needs a
retry. A failed attachment should not require starting the capture over.

Keep Public/Private terminology consistent with the existing design, while
making the consequence explicit: public inspiration means available to all
rooms the person belongs to, including rooms joined later. A remembered
public setting should be visible before saving. Public web profile sharing
is a separate decision. Explain the destination of a capture begun on a room
wall so it is clear whether the person is saving to their own memory or
putting something into that room's shared material.

### Reflection

Keep one question at a time, saved answers, and the current explicit finish
choice. Improve the questions using the new evaluation cases: avoid repeated
rephrasing, leading interpretations, advice, invented emotion, and a sequence
that feels endless. After the current flow is reliable, give the person an
easy way to change a question or add a thought freely. Offer a natural
stopping point after a few useful turns,
without forcing another model call merely to exit.

Show a short, evidence-backed outcome after completion when the system has
one: a pattern was clarified, new evidence was added, the current reading is
still holding, or no useful pattern emerged. The UI must be allowed to say
that nothing new was concluded. Add editing of a saved answer after evidence
reconciliation can honor that edit. Completed answers already support
cross-device reading; defer synchronized unfinished drafts until research
shows a need, since it adds conflict and retention behavior to a simple flow.

### Top of mind and principles

Retain the lead sentence. Add a modest entry point to the other current
questions, tensions, and possible actions; do not require dismissing the
headline to see the rest. A question/action should be usable: answer it,
record a choice, or carry it into reflection. Avoid turning the screen into a
feed of every extracted pattern.

Put “Why this read” one clear gesture away and let it open the exact saved
material or reflection. Give the person a useful before/after comparison
when a reading changes: what changed and what still holds. The word-arrival
animation and date dial can stay, but they are insufficient as the only
explanation of meaningful change.

For a principle, show the independent situations that support it, why the
directive is broader than one project, and any unresolved counterexample.
Keep the existing edit/order/disagreement controls. A dispute should have a
clear consequence in future generation and machine-facing use, and a stable
way back. A principle edited by the person needs a visible indication that
its words are theirs if support later weakens.

### Rooms

The current room composer asks “What do you think this room believes?” That
frames a static belief more than an evolving direction. Present the current
reading alongside the contribution and ask what the group is exploring or
what should change in its direction.

Offer two or three concise starters grounded in public material from at least
two members. Place them in the existing explanation/contribution flow rather
than restoring a separate common-thread section. Let members comment on a
starter or propose wording. Promote a proposed change to a clear member
decision; keep contributions distinct from affirmations.

Implement the requested 50% participation as a rule for the **next reading
round**, not a lifetime participation count. Recommended operational policy:

- A round is based on the current room reading and material revision. Each
  current member counts once after a saved contribution, correction, or
  explicit response to that round. Page views and unrelated past activity do
  not count. A member can revise their contribution without adding a vote.
- The participation threshold is `ceil(currentMemberCount / 2)`. Evidence
  for a collective pattern still needs at least two distinct current members.
  Meeting participation does not turn weak or contradictory evidence into
  agreement, and the generated wording must not imply unanimity.
- When participation and evidence qualify, offer one “Build our next read”
  action in the existing flow. Prepare and validate the next version from
  public material and the round's contributions. Keep the current version
  visible until the replacement is ready; zero useful changes is valid.
- Replace the legacy two/three-affirmed-signal first-draft gate in this new
  path. Stacking it on top of participation would recreate the confusing
  collection of hidden gates. Existing behavior remains the baseline until
  the replacement contract and tests are reviewed.
- Direct member-authored wording proposals keep their current strict-majority
  rule. This is an alternative explicit-edit route, not a second vote required
  after every generated reading. On a proposal, show agreements; on a reading
  round, show contributors. Do not give both numbers the same label.
- Recompute eligibility against current membership before committing the
  version. A departed member stops counting; a new member can change the
  denominator. Record the membership/contribution snapshot on committed
  versions so their history remains understandable.

| Current members | Contributors needed for a reading round | Agreements needed for a direct wording proposal |
| --- | --- | --- |
| 1 | 1, but no collective pattern until there are two evidence voices | 1 |
| 2 | 1, plus the separate two-voice evidence requirement | 2 |
| 4 | 2 | 3 |
| 6 | 3 | 4 |

No quorum should carry forward automatically into the next round. Handle
simultaneous contributions and repeated “Build” presses with one version per
input revision. Later contributions remain available for the next reading;
an older in-flight model result must not consume or overwrite them. The
round definition and build action are proposed product choices, not existing
behavior or an additional requirement for today's room UI fixes.

Show who has answered, who has not, the tally, and the resulting changed
reading. When the next reading is generated, carry open disagreements and
contributions forward. Version comparison should connect a change to the
member input that caused it. Joining a room should preview the existing
public material that will become visible there.

### Navigation, first use, and accessibility

Use stable IDs for wall and inspiration identity, with readable names as
optional slugs. Push meaningful navigation into browser history and handle
Back without rebuilding the world. Include section, selected inspiration,
reflection, and date state where it is useful to restore or share. A rename
must not break an existing room link.

Teach the first complete loop with one real capture, an optional reflection,
and a visible first reading. Onboarding currently asks for a name; it does
not teach why the next action matters. Empty states should offer the next
useful action, not only an explanation of thresholds. Preserve the concise
tone and avoid a tour of every feature at once.

Use readable contrast for active controls, persistent focus indication,
native text input behavior, consistent modal scrolling/focus/dismissal, and
reflow at 200% zoom. Review the same task at 360–390px and with reduced motion
and a screen reader. The mobile composition is visually coherent at 390px;
contrast and interaction ownership remain the more concrete issues.

Before wider launch, deliver password recovery and verify that exports,
account deletion, room membership changes, and public-profile boundaries can
be understood without developer vocabulary.

## Bug fixing throughout every release

Maintain one bug backlog linked to the finding IDs and delivery slices. A
bug report records the affected build/environment, device/input method,
steps, expected behavior, actual behavior, frequency, and user impact. Use
redacted examples and request/job identifiers where useful. Keep suspected
causes distinct from reproduced behavior. When the expected behavior is a
product decision, resolve that contract before calling the implementation
incorrect.

### Initial bug queue

| Area | Findings | Fix and verification focus |
| --- | --- | --- |
| Data and privacy | F1–F4 | Reproduce the boundary or preservation failure first; contain exposure/loss, then verify reconciliation and any historical repair separately. |
| Typing and scrolling | F5–F6 | Slash, caret keys, Escape, wheel, and touch in capture, reflection, room proposals, and evidence panels. |
| Stale or misleading readings | F7–F9 | Visible text matches the completed artifact; pending, unchanged, and failed work produce accurate feedback. |
| Search and navigation | F11–F12 | Search errors remain recoverable; Back, reload, renamed rooms, and selected inspirations restore the correct context. |
| Attachment failures | F13 | A saved capture survives upload/enrichment failure; retry attaches once and reports the actual result. |
| Interaction regressions | F10 and newly reported issues | Check active-control visibility, keyboard focus, small screens, long text, and repeated actions in the affected flow. |

### Fix cycle and definition of done

1. **Reproduce and triage.** Confirm the failure on a named build using an
   isolated fixture. Privacy, lost user content, and incorrect ownership take
   priority; then blocked core tasks, misleading outcomes, and visual defects.
   If reproduction is incomplete, retain that uncertainty in the bug record.
2. **Identify the cause and fix the affected path.** Check sibling surfaces
   that share the same handler or state. Keep the patch narrow enough to
   review; avoid absorbing unrelated feature work into it.
3. **Verify the original failure.** Add meaningful automated regression
   coverage for data/state, concurrency, access boundaries, and recurring
   failures. For a minor visual or copy fix, visual verification and existing
   checks may suffice. Use targeted API/web checks and migration checks when
   relevant.
4. **Check the neighboring journey.** Test the successful path plus the
   relevant retry, refresh, account switch, slow response, or mobile variant.
   Fixing one dialog must not break typing or scrolling in another.
5. **Close with evidence.** Record the root cause, changed behavior, verified
   build, and any remaining repair. Track local verification and verification
   on dev separately. A passing unit test alone does not establish that the
   deployed interaction works or affected historical data has been repaired.

Every release includes a focused pass through capture → reflect → return to
the inspiration → inspect the reading, plus any room flow it changes. Block
release of affected behavior on unresolved P0 defects or a regression that
prevents a core task without a usable workaround. Lower-impact defects retain
an owner and next action. Review recurring/reopened bugs for a shared cause;
use recurrence and user impact to prioritize, rather than raw closure count.

## Delivery plan and dependencies

Build in three releases with small, independently reviewable PRs. S/M/L are
relative sizing, not calendar promises. Acceptance is based on an observable
behavior or data invariant, not a count of files changed. Reproduce a claimed
defect first; if the reproduction disproves it, close or revise the finding
instead of implementing the originally proposed fix.

### Release 1 — a dependable personal learning loop

| Slice | Findings / size | Dependencies | Demonstration required |
| --- | --- | --- | --- |
| A. Input and readable actions | F5, F6, F10 / S | None | Slash and caret keys work in every writer; wheel/touch scrolls the active surface; the scene stays still; active correction controls have sufficient contrast. |
| B. Preserve ownership | F3, F4 / S–M | Minimal failure fixtures | Edited principles survive source loss with truthful standing in UI and machine reads. Two accounts on one browser have isolated drafts/preferences, including requests already in flight. |
| C. Room reflection containment | F2 / M, historical repair separately sized | Reproduction and sharing policy diff | Room input and retrieval use only allowed material; outputs from pre-fix work are assessed separately. Deliver the guard plus a read-only impact report before executing repair. |
| D. Current support reconciliation | F1 / L | B; typed source/revision contract; C for the room path | Source deletion invalidates exact citations; explicit support checks update remaining links; bounded omission and provider failure do not erase support; stale work cannot overwrite newer material. |
| E1. Fresh poster and honest manual refresh | F7, F8 / M | Reproduction and scoped completion contract | A newly completed artifact becomes the displayed lead; queue acceptance never reports a new reading; unchanged and failed results are distinguishable. |
| E2. Visible outcome after capture/reflection | F9 / M | E1; D for claims about changed evidence | The saved answer can be followed to its completed, unchanged, delayed, or failed reading. Leaving the panel does not lose the work; re-opening resumes its real status. |

A, B, C, and E1 can be prepared independently. Do not hold A behind a new
evidence schema. Ship B before enabling D's withdrawal of support so the
repair cannot delete a person's edited principle. Keep C's containment active
while D and historical repair are developed.

Release gate: walk one isolated profile through save → three answers → edit
or retract one answer → updated support → current reading. Repeat with a
failed provider, no new candidate, unchanged output, a daily hold, an account
switch, and an older job finishing last. Each branch must preserve the saved
words and report only what completed. A second profile/room checks boundaries.

### Release 2 — find it, return to it, and recover

| Slice | Findings / size | Dependencies | Demonstration required |
| --- | --- | --- | --- |
| F. Navigation and visible recall | F11, F12 / M | A; route-state design before implementation | Save a link to an inspiration/reflection, open a different room, use Back, and recover the prior view. Find a result outside the initially loaded field. An error never appears as no matches. |
| G. Reliable attachments | F13 / M | A and durable-save/status behavior | Text succeeds while an attachment fails; retry attaches once to that same inspiration. Paste/drop/select have clear previews and destination. |
| H. Progressive startup | F18 / M | Baseline request/latency trace | First useful view waits only on required initial material; unopened details are fetched within a bounded budget. Scrolling, search, and a cold deep link still load their required data. |

F can start alongside Release 1 once the interaction boundary is stable.
Profile large-archive request counts immediately; a narrow prefetch reduction
can ship before this release if it preserves card-opening behavior. Do not
change ranking or field semantics as a hidden part of a loading optimization.

Release gate: on the same seeded small and large archives, a person can find
an older inspiration, read its reflection, move between rooms and Back, save
a link/image, and recover from an attachment error without reconstructing
the capture. Record task time, errors, and request counts against the baseline.

### Release 3 — better readings and shared participation

| Slice | Findings / size | Dependencies | Demonstration required |
| --- | --- | --- | --- |
| I. Generation evaluation and focused tuning | F14, F16 / M then separate experiments | Start baseline cases now; D before changed-support scoring; E before judging the visible outcome | A candidate improves a declared failure category without hiding missed topics, false certainty, or abstentions inside an aggregate score. Add access to secondary current entries only after a prototype shows a useful next action. |
| J. Next room reading | F15 / L, split UI/contract/worker PRs | C, D, E; participation contract above | Grounded starters reuse shared material. Two contributors in a four-member room qualify the reading round when evidence supports it. A direct wording proposal separately needs three agreements. Dissent and late contributions survive. |

Build the evaluation fixtures before tuning, and prototype the room interaction
before implementing its persistence. “Build our next read” and contribution
rounds are a proposed replacement experience, not a prerequisite for fixing
today's proposal button, scrolling, or count labels.

### Independent launch requirements and deferred ideas

- **Password recovery (F17):** an independent pre-launch requirement. Choose
  the delivery mechanism, token lifetime/single-use behavior, enumeration-safe
  response, and session invalidation policy. It must not wait for search or
  algorithm tuning, and an unprovisioned email service is a named dependency.
- **Policy documentation (F19):** update the affected canon/glossary/product
  explanation with each slice. Remove contradictory current claims without
  erasing dated decision history. Do not leave this until a final cleanup.
- **Onboarding:** test one contextual next-action hint in the repaired loop
  before planning a guided tour. Empty states must not promise that a first
  capture will necessarily yield a principle.
- **Defer from the next release:** synchronized unfinished drafts, per-room
  reflection sharing, new public maturity labels, a broad analytics system,
  replacement of the spatial home, and multiple simultaneous model/threshold
  changes. Each needs a specific demonstrated user need or evaluation result.

## Validation and learning

### Minimal reproductions before fixes

Use isolated local/test profiles and an injected provider for exact edge
cases. Verify the database destination explicitly: earlier local work found
`.env.local` pointing at remote Neon despite the repository's local-default
notes. Do not modify the founder's account to obtain a clean fixture.

| Scenario | Expected invariant |
| --- | --- |
| Unchanged capture; extractor omits a previously supported claim | Omission alone removes no support. |
| Delete the reflection that supplied a quote | That quotation stops being current; an explicit check decides whether other material still supports the claim. |
| Edit during a slow model call; older job finishes last | Only results for current authorized material may commit. |
| Model timeout, malformed result, or a valid empty candidate list | Failure, abstention, and explicit withdrawal remain distinct. |
| All support disappears beneath edited words | Preserve the words, show truthful support status, and honor it in machine-facing use. |
| Edit a private reflection while public captures stay fixed | Room retrieval/prompt inputs stay within the public projection; test legacy prompt context and historical serving too. |
| Visibility or membership changes during generation | Revalidate at commit and serving; neither pending jobs nor caches bypass the change. |
| Account A signs out with a draft; B signs in | B receives none of A's draft, preference, in-flight result, or rendered memory. |
| Repeated save/refresh/retry and an ambiguous network response | No duplicate answer, evidence, or version; use request identity or reconciliation where current endpoints lack it. |
| Queue accepts a refresh but is delayed or completes unchanged | The UI reports the actual outcome and displays a matching artifact revision. |
| Room size changes while a next reading is prepared | Current eligibility is rechecked; committed history keeps the snapshot that governed it. |
| Wheel, slash, caret keys, Tab, Escape, and 200% zoom | Each overlay owns the interaction consistently on desktop and mobile. |

These fixtures exercise failure and race behavior rather than mirroring the
implementation. Unit checks cover pure rules; database checks cover ownership,
transactions, and support changes; browser checks cover the visible journey.
Run the checks relevant to each PR. Paid live evaluations remain separate.

### Quality evaluation with a meaningful baseline

Begin with a small, reviewed set of 12 representative scenarios to validate
the scoring rubric, then expand to 40–60 fixed scenarios for comparisons.
Reuse the existing extraction/judge/pipeline benches. Include quoted ideas
the person rejects, intentions versus actual choices, one-time fascination,
multiple themes, reflection-led changes, nonsensical answers, same-day bursts,
overlapping evidence, long gaps/comebacks, contradictions, and an outspoken
room minority. Include expected-abstention and must-detect cases so a system
that says nothing cannot appear best merely by avoiding wrong answers.

For each output, record separate judgments:

| Dimension | Question for the reviewer |
| --- | --- |
| Support | Does the cited material support the conclusion without inventing a preference, emotion, event, or consensus? |
| Attribution | Can the reader reach the exact capture or reflection and revision? Is it authorized for that reader? |
| Calibration | Does wording distinguish a passing interest, intended choice, repeated behavior, and unresolved tension? |
| Coverage and abstention | Were required themes heard and unsupported themes omitted? |
| Usefulness and distinction | Does this help the person think or choose, and does it add something beyond the current headline? |
| Conversation quality | Does the next question respond to the answer and explore something new without leading or repetition? |

Run baseline and candidate on the same inputs with recorded provider, model,
prompt, and policy versions. Review anonymized, order-shuffled output pairs;
separate implementer review from independent/user review where possible. Repeat
a representative subset to expose variance. Change one major factor per
experiment. Predeclare the model-call/cost limit and stopping condition before
the live comparison; this plan does not resume a previously halted eval goal.

Hard regression gates are zero unauthorized source access, zero lost human
edits, correct ownership/citation references, and rejection of stale commits
in the deterministic cases. High-severity invented identity claims or room
consensus require review even if the aggregate quality score improves.
Report numerator, denominator, per-category outcomes, and abstention/coverage
together. Establish release thresholds after rubric calibration and before
examining candidate results. Heuristic confidence scores are not measured
probabilities that a statement is true.

### User experience and operational measurements

Start lightweight measurement in Release 1, not the final phase. The primary
outcome is **successful return and understanding**: can someone find a saved
inspiration, recognize what their reflection contributed, and correctly explain
why the current reading changed or stayed the same? Track saved/reflected
sessions separately; longer conversations alone are not evidence of value.

Use five participants for an initial qualitative round with the same tasks:
capture, optional reflection, later retrieval, explain a principle, correct a
reading, and participate in a room. Record unaided completion, wrong turns,
time, and misunderstandings. Four-of-five unaided completion is a directional
design check, not a statistically established success rate or a hard reason
to ignore a serious failure by the fifth person.

Measure save acknowledgment, queue wait, provider duration, first useful
render, follow-up readiness, correction-to-visible-change, attachment recovery,
search success, and proposal-to-reading. Separate ordinary interactive
requests from daily-held and batch work. Report p50/p95 with sample counts;
agree latency budgets after a baseline on a named device/network profile.
The earlier 2.5s render / 1s save / 10s follow-up numbers are design aspirations,
not current measurements or release promises. Waiting and recovery UX is
required regardless of whether a provider reaches those aspirations.

Extend the existing developer-facing traces with request, material, job,
artifact, and policy identities plus stage timings/outcomes. Keep routine
telemetry to identifiers, timings, counts, and error classes; do not copy
private answers into broad logs. Diagnostic content access should use the
same profile boundaries as the app. Compare actual calls/tokens as well as
job counts before changing the 60-starts-per-account-hour limit. Evaluate
priority for an explicit follow-up without starving other accounts or
background derivation.

## Rollout, historical repair, and stop conditions

1. Make schema changes additive and backward-compatible with in-flight workers
   where possible. Define new concepts in the canon first. Deploy readers
   that tolerate old rows before requiring new provenance fields.
2. Exercise old and new behavior on isolated seeded profiles. For evidence
   reconciliation, compare proposed changes without applying them first.
   Inspect both false retention and false withdrawal, using metadata-only
   reports when private content is unnecessary.
3. Ship narrow code fixes independently. Validate the new personal flow and a
   small known room on dev before expanding scope. Review current and
   historical output serving, not only the newest row.
4. Produce a repair manifest naming affected IDs/scopes, intended operations,
   preserved human words, retention treatment, and recovery path. Separate
   definitive matches from potentially affected records. Execute only a
   reviewed batch with idempotency, checkpoints, and bounded model work.
5. Stop expansion if any protected words disappear, an unauthorized source is
   used, a stale revision commits, or unexpected evidence withdrawal appears.
   Pause the responsible writer/serve restricted output as appropriate while
   preserving saved inputs. A rollback must not reactivate the privacy path
   or republish redacted private derivatives.

Do not automatically restore deleted text as a rollback. Repair and recovery
must honor the person's current deletion and sharing choices, including
cached/job payloads and historical views. A backup is not permission to serve
content that was withdrawn.

## First handoff and connection to existing work

The next handoff consists of separately reviewable A (overlay input/contrast)
and B (edited-word and account-draft protection) changes, minimal F1/F2 failure
fixtures, and the proposed source/projection contract for C/D. That is a
bounded starting scope. E1 can follow independently; the full Release 1
journey closes only when D and E2 pass their gates.

Use the existing goal records as context: interaction and recovery work fit
`every-workflow-works`/`one-product-one-system`; learning visibility connects
to `the-legible-loop`; room comparison connects to `room-timeline`; generation
policy belongs with `principles` and `generation.md`. Verify each goal's own
status before editing it. Do not revive superseded room goals or imply that
the separately gated “kept but not evidence” feature is included here.

Record each implemented slice against its finding IDs, reproduction, changed
behavior, checks, migration/repair state, and remaining uncertainty. Keep
shipped fixes, validated product changes, and remaining hypotheses visibly
distinct in the implementation record.
