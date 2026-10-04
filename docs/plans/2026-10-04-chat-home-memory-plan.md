# Chat experience home hierarchy and memory quality

Status: proposed, not implemented. Prepared 2026-10-04 against `84cba13` on dev.

Execution update: the owner subsequently requested all milestones. Work is
tracked in [the implementation goal](../goals/chat-home-memory.md). The
proposal below retains its original scope and acceptance criteria; deployment
still requires a separate request.

This plan addresses three pieces of feedback: Talk with WAKA should feel like
a regular AI chat informed by personal memory; home actions should have clear
roles instead of sitting in rows under Top of Mind; and the generation of Top
of Mind and Principles needs a quality review. Keep WAKA's dark atmosphere,
typography, companion and restrained visual style. Improve structure rather
than replacing the identity with a generic dashboard.

The current request is planning only. No code, generation settings, account
data, model calls, migrations or deployments are authorized by this document.
Personal profiles are the focus; room expansion, native packaging and store
release remain outside scope. Implement one approved milestone at a time.

## Findings from the current app and code

### Chat

The deployed entry is still a centered dialog over the home scene. Conversation
history is a list of large buttons, and the conversation contains navigation,
memory inspection, correction controls and a form-like composer. Routes exist,
but `/chat/:conversationId` still mounts the whole Home layout. A route alone
has not made this a dedicated chat experience.

Memory is already connected, but the promise needs to be more precise. The
current context reader takes up to ten Principles by rank, five current Top
of Mind entries and six inspirations matched by words in the latest message.
Inspiration matching is substring matching with up to eight terms of at least
three characters, ordered by newest capture. This path loads inspiration text,
not the reflection/transcript/image-derived material used by other parts of
the memory pipeline. The reply history is also bounded to the last eight
messages and 8,000 characters.

Consequently, paraphrases, short Korean questions, follow-up pronouns and
audio/photo-only captures can be poorly served. This is a code-grounded risk,
not a measured failure rate. The current prompt's one-to-three short statements
and separately constrained question also make chat resemble a reflection
exercise. A follow-up is optional in the contract; it is not literally required
after every answer.

Sources: [chat UI](../../packages/web/src/components/ConversationPanel.tsx),
[route layout](../../packages/web/src/main.tsx),
[context selection](../../packages/api/src/lib/conversation-context.ts),
[reply lifecycle](../../packages/api/src/lib/conversation-replies.ts), and
[reply prompt and parser](../../packages/api/src/queue/gemini.ts).

### Home

After reloading the deployed build, Review/Resume review and Talk with WAKA
occupy one row below the reading, with Why this reading and What changed in
another. The actions are technically separated, but still visually belong to
one block. Navigation, explanation and starting a new activity need different
placements, not just different button styles.

Source: [home rendering](../../packages/web/src/pages/Home.tsx).

### Generation today

| Layer | Actual behavior | Implication |
| --- | --- | --- |
| Signals | A capture can propose up to three signals. Three independent evidence units are required for initial promotion to active. Reflection/review support and current-material checks already exist. | Raw inspiration count is not a reliable progress meter. Three signal IDs are also not proof of three independent life contexts. |
| Top of Mind | Normally selects up to twelve signals using confidence 45%, support 20%, recency 20%, comeback 15%. Disputed signals are downweighted. Cold start borrows emerging signals when there are fewer than three active ones. | Existing confidence already includes support and recency; test the combined weighting before changing it. Established profiles exclude emerging signals, which may delay a genuinely new focus. |
| Top of Mind publication | One synthesis proposes up to seven typed entries. Automatic content shifts have a 24-hour floor; initial and manual reads are exempt from that floor. Human locks, current citations and version checks are enforced. | Saved does not mean a reading changes immediately. The home headline uses a pinned entry or the first entry, so the visible headline and the full artifact are separate things to inspect. |
| Principles | A candidate needs at least three distinct active signals, evidence on each, and one Top of Mind appearance across their union. The minimum evidence span is currently zero days. Up to three candidates are proposed per run, then compared with the standing set. | There is no calendar-based durability requirement. This deliberately supports early output, but does not itself distinguish a lasting principle from a concentrated burst of interest. |
| Principle scheduling | Completed readings can enqueue an eligible, fingerprinted Principle pass. Explicit ensure/retry and periodic recovery also exist; GETs do not create generation work. | Do not describe Principles as only generated nightly or as live-generated on every page view. |

These are code/default-policy findings, not an inspection of deployed database
contents or secret environment overrides. There is no universal “save N
inspirations and get a Principle” threshold.

The strongest concrete scheduling concern is that `no_change` Top of Mind
passes still create versions, the Principle material loader counts those
version IDs, and its fingerprint includes the IDs. For eligible profiles an
unchanged reading can therefore produce a different fingerprint and enqueue
another Principle pass. Reproduce the chain in a database test before fixing
it; do not remove useful audit records to avoid the cost.

Other review targets are semantic grounding beyond valid citation IDs,
same-origin overlap across signals, unbounded active-signal input to Principle
distillation, and candidate-to-standing-Principle comparison cost. Some prose
in `docs/generation.md` still says review support is not connected even though
the worker dispatch and implementation exist. Reconcile that documentation
before treating its prose as the current algorithm contract.

Sources: [signal derivation thresholds](../../packages/api/src/lib/signal-derivation-thresholds.ts),
[independent evidence and confidence](../../packages/api/src/lib/signal-lifecycle.ts),
[Top of Mind selection and publication](../../packages/api/src/lib/top-of-mind-synthesis.ts),
[Principle eligibility and generation](../../packages/api/src/lib/principle-generation.ts),
[Principle fingerprint](../../packages/api/src/lib/principle-status.ts),
[worker dispatch](../../packages/api/src/lib/queue.ts),
[review derivation](../../packages/api/src/lib/review-answer-derivation.ts).

## Milestone 1 A regular chat informed by personal memory

### Intended experience

Talk with WAKA opens a dedicated conversation page, not a small overlay. The
AI helps with a question, idea or choice, using relevant personal context when
it helps. It does not impersonate the person, turn every answer into coaching,
or force a Principle into an unrelated response.

- Desktop: a restrained conversation sidebar and a spacious central message
  column. Keep history and settings out of the transcript.
- Mobile: full-screen conversation, back navigation and a history drawer.
  One scroll region and a bottom composer that stays above the keyboard.
- Visually distinguish user messages from assistant replies. Use readable
  paragraphs and safe Markdown for lists and emphasis, without excessive boxes.
- Show one subtle context entry, such as “Your memory,” opening a side panel or
  mobile sheet. Distinguish memory available to the request from sources
  actually cited in a reply. Do not imply the entire archive was read.
- Keep citations and compact save/correct actions connected to their reply.
  Do not add a large button after every user message or bury essential actions
  under an undifferentiated More menu.

### Tasks

1. Extract chat into a protected route outside the canvas/Home lifecycle while
   retaining existing URLs, auth, back links and account/profile isolation.
2. Separate conversation navigation, transcript, composer and context panel.
   Use a short first-line title with a date; automatic paid title generation
   is unnecessary for this milestone.
3. Open new chat directly to a ready composer with a few optional starters.
   Persist a new conversation on first Send, preserving the existing durable
   request identity through creation/message failures and avoiding duplicate
   or empty conversations from an interrupted request.
4. Implement growing input, desktop Enter to send/Shift+Enter for a new line,
   Korean IME protection, and an explicit mobile send button. Preserve drafts,
   scroll position, stop/retry behavior and accessible message announcements.
5. Make reply behavior adaptive: answer direct questions directly, explore
   when invited, allow useful lists, and ask a follow-up only when needed.
   Update the schema/parser and quality cases together, not only the prompt.
6. Show immediate user-message acknowledgment and a truthful thinking state.
   Do not simulate token streaming by animating a finished reply. Real streaming
   is a separate delivery spike: show drafts as provisional until validated,
   preserve stop/current-memory fences, and store only completed valid replies.
   Start without it if those guarantees cannot yet be preserved.

Exit gate: desktop/mobile new chat, history, reload, back navigation, IME,
keyboard, long replies, interruption and failed-send recovery work. No extra
model call on opening a chat, no duplicated message and no silent memory edit.
The user can identify the AI reply, send another message and inspect its
references without reading instructional paragraphs.
If the prompt or reply schema changes, the existing bilingual 18-case chat
quality gate and new direct-answer cases must pass before release, under an
announced evaluation budget. Component tests alone do not prove reply quality.

## Milestone 2 Give home actions distinct jobs

Keep Top of Mind as a readable statement. Remove the action strip beneath it.
Use the existing restrained borders and spacing to make two clear activity
cards, side by side on wider screens and stacked on mobile.

| Element | Proposed placement and role |
| --- | --- |
| Capture inspiration | One persistent primary capture control using the current composer. |
| Top of Mind | The reading itself, with date and a compact Why this reading disclosure attached to it. |
| What changed | A labeled Changes control in the reading header, not another activity alongside chat/review. |
| Review inspirations | Its own activity card. Show the actual resume state or a short invitation to revisit saved inspirations. One clear CTA. |
| Talk with WAKA | Its own activity card opening the chat composer. Explain its personal-memory context in one short line. |
| Principles | A persistent, clearly labeled destination; do not bury it in a menu or add another competing CTA beneath the reading. |
| Processing | Quiet status attached to the reading. Error recovery stays actionable; routine scheduled work does not dominate the screen. |

Tasks: define the shared action-card component; relocate the existing actions;
connect truthful resume/empty states; make return navigation preserve the
original location; test the relationship between card height and the companion
scene. Do not reintroduce the removed Common thread section, contribution
categories or multiple public maturity labels.

Exit gate: capture, review, chat and Principles are visually distinct at 320,
390, 768 and 1280px; long Korean/English text and loading/error states do not
overlap. Primary targets remain at least 44px high and text inputs at least
16px. In a short usability check, a person can choose the right action for
“save this,” “revisit my inspirations” and “talk through a choice” without
needing an explanation of the layout.

## Milestone 3 Improve memory relevance and generation quality

Split this milestone at a measurement checkpoint. Reliability fixes and
retrieval quality come before changing the generation thresholds.

### First checkpoint Trace reproduce and fix concrete gaps

1. Record one trace per evaluated journey: source revision, derived signals,
   independent evidence units, selected signals, hold/retry reason, resulting
   artifact, displayed headline and Principle outcome. Keep this developer
   evidence metadata-only by default, not another public status system.
2. Reproduce unchanged-reading fingerprint churn. Base eligibility and job
   identity on meaningful evidence/content changes, preserving audit records,
   locale changes, current support and human-edit invalidation.
3. Improve chat retrieval using the existing owned recall/embedding paths:
   lexical plus semantic matching, conversational query context, relevance
   ranking and diversity within explicit input budgets. Include authorized
   reflections, corrected transcripts and appropriate derived media context
   with clear provenance; do not dump the full archive into a prompt.
4. Test short Korean inputs, paraphrases and “what about that?” follow-ups.
   Preserve current-source validation when opening citations and publishing
   replies. Treat retrieved memory as optional context, not a command or proof
   of the person's current intent.
5. Bound Principle candidate material and comparison work. Measure query,
   token and model-call costs on large synthetic profiles; preserve conflict
   detection and human-owned wording rather than arbitrarily dropping old
   Principles to fit a budget.
6. Update contradictory generation documentation and pin new contracts in
   tests. Do not perform historical-data repair or regeneration as part of an
   apparently harmless read or UI deployment.

Exit gate: unchanged material causes no redundant paid Principle work; current
changes still enqueue it. Ownership, stale-reference, human-lock, disagreement,
save/retry and duplicate-counting tests all pass. Retrieval is compared against
the current lexical baseline on fixed labeled queries, with irrelevant-memory
injection and latency measured as well as recall.

### Second checkpoint Calibrate Top of Mind and Principles

Top of Mind should answer “What matters to me now?” Principles should answer
“What tends to guide my choices?” They should not be two phrasings of one
sentence or an unsupported personality profile.

Evaluate these changes separately, against identical inputs:

- **Top of Mind:** recent relevance versus stable background interests;
  dominance by repeated near-duplicates; new-focus recall on established
  profiles; diversity; meaningful change versus paraphrase churn; pinned lead
  selection versus changes elsewhere in the artifact.
- **Cadence:** retain the current daily stability rule initially. Make its
  schedule and manual refresh understandable. Consider a review-completion or
  explicit new-focus refresh policy only after measuring latency, churn and
  cost; do not silently turn every capture into a manual bypass.
- **Principles:** measure distinct originating experiences, repeated choices
  across contexts and temporal evidence, not just the number of signal IDs.
  Keep initial output possible and use appropriately limited wording when
  support is thin. Compare stricter durability rules offline; do not blindly
  replace the zero-day rule with a new seven- or fourteen-day wait.
- **Grounding:** valid IDs and literal quotes are necessary but not sufficient.
  Review whether cited evidence actually supports the inferred claim. Preserve
  real conflicts and explicit scope such as “today” or “this project.”
- **User control:** retain exact human edits and explicit adoption. Chatting
  alone must not automatically rewrite Principles or count AI-generated text
  as a new independent human experience.

Use at least 24 fixed labeled scenarios spanning new/sparse profiles, one-day
bursts, repeated themes across dates, shifting interests, contradictory
evidence, corrections, deletion, photo/audio-only input and Korean/English.
Define expected acceptable outcomes before comparing baseline and candidate.
Include no-output cases; generating more Principles is not a success metric.

Proposed release gate: every safety case passes; no unsupported personal claim
is accepted in the reviewed set; at least 90% of cases meet the predefined
relevance/specificity/confidence rubric; the candidate improves the targeted
baseline failures without new regressions. Report exact counts and limits,
not a population-quality guarantee. Record latency and cost per useful result.
Paid runs require an execution request and an announced call/cost cap; none
are part of preparing this plan.

## Implementation order and release boundaries

Recommended order: Milestone 1 chat experience, Milestone 2 home hierarchy,
then Milestone 3 first checkpoint and its calibration checkpoint. The first
two can ship without changing generation thresholds. Each checkpoint gets a
small PR, focused regressions and an actual browser walkthrough. Ship to dev
only when requested; production remains a separate decision.

Keep UI/routing changes separate from material-key, retrieval and threshold
changes so failures can be isolated and rolled back. Do not remove stored
inspirations, rebuild historical memory, change provider models or loosen
budgets as a shortcut to making the new interface look populated.

## Recommended next action

Approve the dedicated-chat and two-activity-card direction, then implement
Milestone 1 only. Stop for a usable checkpoint before starting the next one.
Algorithm calibration should follow the measured baseline, not an arbitrary
new inspiration-count threshold.
