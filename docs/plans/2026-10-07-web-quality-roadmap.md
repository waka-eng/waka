# WAKA web quality roadmap

Status: implementation plan requested by owner (2026-10-07), with simplicity
and intuitiveness as the usability priorities. Implementation has not started.

Improve the everyday personal web experience: capture an idea, revisit it,
understand the reading and Principles, and have a useful conversation grounded
in memory. Preserve the established visual identity and human wording locks.
Native M3–M6 remain on the [mobile roadmap](2026-10-06-capacitor-mobile-plan.md);
native capture is paused rather than complete.

## Current baseline

The [dev validation](../goals/dev-validation.md) passed the scoped personal
journey, including draft return, source reopening, Back and ambiguous save
recovery. The [performance work](../goals/performance-improvements.md) reduced
local request volume and readiness time. Subsequent
[responsiveness work](../goals/responsiveness-reliability.md), merged in PR 358,
reduced Review Next from 28 to 20 application statements and chat status from
seven to four, and added bounded transient retry delivery. Reimplementing these
changes would not close their remaining deployed measurement gaps.

The [beta readiness goal](../goals/beta-readiness.md) still has open human
comprehension, operational and deployed timing gates. Its fixed synthetic
generation matrix passed 24/24 qualitative cases; chat passed 23/24. Those
results do not establish extraction quality from arbitrary captures or
independent human usefulness. Retain the failures and their existing rubrics.

## What simplicity means

The main journey is **save something → return to it → use what it teaches you**.
Someone should be able to do that without learning the memory pipeline or the
spatial navigation first. These are proposed design changes grounded in the
current components; their usability benefit still needs browser and human checks.

- Give each task one visually primary action. Keep useful alternatives quieter.
- Keep navigation in predictable places with visible text. Spatial movement and
  the companion can enrich navigation; every core destination also needs an
  obvious labeled route.
- Ask for a decision when it matters. Saving should not require choosing whether
  to reflect, generate a reading or begin a conversation.
- Reveal detail on request. Evidence, earlier wording and advanced controls
  belong beside the thing they explain, behind a clear label.
- Say what happened and what the person can do next. Distinguish a draft, a
  confirmed save and background processing without teaching internal job states.
- Preserve privacy choices, human wording and recovery controls while simplifying
  presentation. A smaller interface must still make consequences clear.

## Proposed experience

### Home and navigation

Make Capture the primary action, changing it to Continue your draft when there
is unfinished input. Keep Review and Talk with WAKA as quiet, clearly separated
activities. Give Inspirations and Principles stable labeled entry points; place
Find with the saved inspirations and keep it reachable from Home. Reuse existing
routes and controls, consolidating duplicate entry points where they compete.

Show one concise Top of Mind reading with optional supporting detail. Use a
plain explanation where needed: Top of Mind describes what seems relevant now;
Principles are guides drawn from repeated patterns. Keep the established names
and reconcile any proposed copy with the glossary before implementation.

For an empty account, lead with one invitation to capture something and a short
example. Introduce the reading and Principles when they have something useful
to show. Avoid a tour requiring users to understand every feature before saving.
Do not imply a guaranteed number of saves or a date when a Principle will appear.

### Capture

The current [composer](../../packages/web/src/components/InspirationComposer.tsx)
already combines text, links, photos and recording, but presents both Save and a
save-and-reflect action. Make **Save** the single primary completion action.
After confirmed success, offer an optional Reflect action on the saved item;
the person can leave immediately. Preserve any needed efficient shortcut as a
secondary action only if the prototype shows it helps frequent users.

Keep the text field first and media controls in one quiet row. Retain direct
paste/drop behavior. Test recognizing a pasted URL in the main field and
consolidating the separate Link/Add step, with explicit previews and removal.
Typing must never trigger a silent save or an unexpected external fetch.

Show the actual audience beside Save. Retain the existing privacy rules and
explain any wider audience before it is chosen. Show one coherent progress or
recovery message per operation; surface individual file problems only where
the user needs to act. Preserve the full draft when any step fails.

### Review and saved inspirations

The current [Review card](../../packages/web/src/components/ReviewPanel.tsx)
already shows one inspiration and explains that Next keeps it. Keep that model.
Make Reflect primary and Next inspiration secondary. Move Remove inspiration
into a labeled item menu with its existing explicit confirmation.

Keep the original visible while reflecting. Make saving an answer and finishing
the current reflection unambiguous; avoid competing completion buttons whose
different effects need explanation. After finishing, show a quiet saved state
and one optional next step. Closing or returning must restore the same place.
Preserve intentional multi-step reflection rather than automatically advancing
or generating another question after every save.

Find should open the actual saved item, with matching text and date sufficient
to recognize it. Keep search wording, Back behavior and empty/no-match/failure
states consistent. Expand filters only in response to observed retrieval needs.

### Top of Mind and Principles

Lead with the words, followed by a clear way to see why they appeared. Keep
evidence, changes and editing controls subordinate to reading. A selected
Principle can offer Talk with WAKA and Share a principle in context; avoid
repeating all management controls on every collapsed item.

Explain uncertainty in plain language and only where relevant. Differentiate
insufficient evidence from loading and failure. Never replace the person's
edited words or imply that an empty reading means their saved inspirations
have disappeared.

### Chat

Keep the existing dedicated chat page and familiar message composer. Its
[message components](../../packages/web/src/components/ConversationPanel.tsx)
can show takeaway, correction, source and continuation actions beneath replies.
Prototype compact labeled source summaries and a per-message actions menu for
occasional operations. Keep correction discoverable and all menus usable by
keyboard and touch, without hover-only controls.

Open memory detail when requested. Preserve the explicit distinction between
keeping one's own words and rewriting/adopting a takeaway from WAKA. Choosing
a suggestion must not overwrite an unfinished message. Replies should answer
the question directly, use personal context when relevant and ask a follow-up
only when it helps.

## Implementation sequence

| Batch | Deliverable | Gate before moving on |
| --- | --- | --- |
| 1. Establish the baseline | Walk the current built app with fresh, returning and large synthetic accounts. Record screenshots, visible choices, task steps and failure behavior. Produce desktop and narrow-screen prototypes for Home and Capture. | Each proposed change has a specific friction hypothesis and a comparison task. Reuse behavior that already works. |
| 2. Simplify the first minute | Implement Home hierarchy, stable labeled navigation, the empty state and Save-first Capture. | Capture is reachable in one action from Home; plain text saves without a reflection decision; audience is visible; draft return and confirmed-save behavior pass. Compare task steps with the baseline. |
| 3. Simplify return visits | Refine Review, saved-item navigation, reading/Principle detail and chat message actions. | Find/open/Back restores context; Next preserves the original; destructive controls are separate; evidence and corrections remain reachable; keyboard and narrow layouts pass. |
| 4. Make the flow dependable and useful | Repair measured latency/recovery issues and evaluate raw-capture-to-reading/chat quality. | No input loss or duplicate writes in the exercised faults. Report deployed cold/warm timing separately from local tests. Preserve the fixed >=90% AI quality bar and every critical safety case. |
| 5. Validate intuitive use | Observe first-time participants, repair recurring confusion and repeat affected tasks. Complete the existing operational release checks. | Proposed formative target: at least 4 of 5 participants complete each core task unaided, with zero mistaken public shares or deletion-by-navigation incidents. This small study guides iteration; it is not a population-level usability claim. |

Use the existing five human tasks: save privately and recover a draft; find and
revisit a saved idea; find Principles; discuss one with WAKA; prepare a Principle
image to share without changing its words. Do not give button names or point at
controls. Record first action, completion, hesitation, requests for help and
wrong turns. Add a brief check that each person can distinguish saved content
from a draft and a reading that is still processing.

The first-time human gate remains open if participants are unavailable; agent
walkthroughs cannot pass it. Technical repairs and prototypes can proceed.
Keep the existing readability and touch-target constraints, visible focus,
screen-reader labels and reduced-motion behavior in every batch. Test both
currently supported locales for wrapping and clarity.

## Quality work alongside usability

Measure Home readiness, Review Next, chat reply time and return navigation on
the deployed revision before claiming speed improvements. Attribute delay to
API/database, queue, provider and publication. Use the existing performance
gates for controlled local comparisons; set deployed targets from an observed
baseline before optimizing further.

Extend AI evaluation from the fixed fixtures through actual extraction from
synthetic text, links, photos and audio. Score usefulness, specificity, natural
language and support separately. Reproduce the retained chat wording miss and
include corrections, sparse memory and changing interests. Keep English/Korean
coverage and compare identical cases before and after prompt changes.

Release readiness still includes exercised recovery/alerts, provider/source
policy verification and actual recurring spending enforcement. Resolve the
recorded USD 5/month environment scope before configuring limits. These follow
the existing beta-readiness goal; this plan does not reopen the wider room
backlog or mark any existing milestone complete.

## Work boundaries

Keep native changes on `codex/capacitor-m3`; use a separate checkout based on
the current web development baseline when starting web implementation. Preserve
the latest uncommitted native recovery work. Run API/web types and targeted
tests appropriate to each repair, and the relevant browser journey afterward.
Database fixtures use an explicitly verified disposable loopback target.

Reconcile the latest cumulative evaluation ledger before live AI comparisons.
The responsiveness goal records USD 3.1340356674 used or held out of the
existing USD 5 evaluation authorization, including an unresolved USD 1.50 dev
reservation. The monthly operating budget is a separate decision. Publishing,
deployment, real-account mutations and provider administration retain their
own authorization boundaries.
