# Chat home and memory improvements

Status: in progress (2026-10-04).
Branch: `codex/chat-home-memory`, starting from `84cba13`.

## Objective

Implement every milestone in the approved
[chat home and memory plan](../plans/2026-10-04-chat-home-memory-plan.md).
The owner now requests all milestones, superseding the proposal's initial
one-milestone execution recommendation. Preserve its acceptance criteria,
personal-profile scope and existing visual feel. Deployment is not included.

## Gates

1. Dedicated chat: protected route independent of the Home canvas; regular
   conversation layout, history and memory panel; durable atomic first Send,
   draft/retry/stop/citation/adoption preservation; responsive keyboard/IME and
   safe rich text. Baseline the existing reply quality before changing its
   restrictive format, then pass the original 18 cases and direct-answer cases.
   Real streaming is gated on preserving validation and publication fences;
   do not fake streaming or weaken those guarantees.
2. Home hierarchy: separate review/chat activity cards; reading-specific
   explanation/changes; persistent capture and Principles; correct empty and
   resume states and 320/390/768/1280px browser checks.
3. Memory reliability: reproduce unchanged-reading Principle job churn;
   remove redundant work while keeping meaningful invalidation; bounded hybrid
   retrieval over authorized personal material and conversational queries;
   bounded Principle inputs/comparisons preserving conflicts and human words;
   metadata-only traces and corrected documentation. Compare retrieval against
   the current lexical baseline on fixed labeled queries.
4. Generation calibration: at least 24 predeclared scenarios comparing current
   and candidate behavior. Evaluate relevance, diversity, new-focus recall,
   repetition, durability, semantic grounding, latency and cost. Every safety
   case passes, no unsupported personal claim is accepted, and at least 90%
   meet the fixed quality rubric without regressions. Preserve the daily
   stability rule unless measurements justify a separately recorded change.
5. Final acceptance: targeted and full regressions, actual desktop/mobile
   walkthroughs, exact fixture cleanup, evidence and per-milestone commits.
   No remote-account mutation, historical repair, provider swap, production
   rollout or silent adoption of assistant text.

## Verification and budgets

Use explicit disposable loopback Postgres for SQL and browser fixtures, never
implicit local-env DB settings. Model evaluations use synthetic inputs only.
Announce each paid batch before execution; stop at its call/cost cap and on
deterministic provider configuration/authentication failures. Current local
env files contain a Gemini key but no OpenRouter key. The owner said the key
exists in `.env.local`; a fresh read of this checkout still finds only the
Gemini key. The correct local file/variable is being clarified. No test branch
push or CI evaluation was authorized by that reply. The proposed first chat
comparison remains bounded to 48 synthetic calls and USD 1. Continue independent
local UI/storage work without changing the unmeasured reply prompt.

## Log

### 2026 10 04 start

The plan is the only pre-existing untracked file; it was created in the prior
planning turn and is preserved. Milestone 1 begins with routing and durable
first-message behavior. No prompt or model policy has changed yet.

### Milestone 1 chat screen and first Send checkpoint

Implemented a protected, separately lazy-loaded chat route outside Home and its
canvas. Desktop has conversation navigation, transcript and an optional memory
panel; mobile has a full-screen composer and mutually exclusive history/memory
drawers with a backdrop. Lists, emphasis and inline code render as React text,
never model-provided HTML. Context available to a request is distinguished from
the references attached to a reply. Current first-line titles need no model call.

Opening the composer, including from an owned Principle, creates no conversation.
The first Send commits conversation, first user message and reply request in one
transaction. Replay recovers the same words; competing/revised messages conflict.
Deleted starting references are not restored by recovery. Browser drafts remain
account/profile scoped; unknown outcomes retain their request identity. New
conversation navigation, safe return paths, Enter/Shift Enter, Korean composition,
mobile Enter, visible viewport sizing and transcript scroll recovery are covered.

Baseline: 38 focused web tests passed before changes. The last full web run in
the first implementation turn passed 700 tests; current focused recheck is 28/28.
API unit 766 passed, three paid benches skipped; conversation SQL 11/11 plus
reply SQL 18/18 passed on explicit loopback fixtures. Web/API types and web build
passed. A new test initially omitted a required fixture rank and was repaired;
obsolete copy and outdated UI assertions were updated without removing their
underlying safety checks.

Actual built-browser checks showed zero canvas elements in chat, a 16px composer,
and zero stored conversations before sending. A deliberately lost first-send
response recovered by GET after reload: one conversation, one user message and
one reply request. A later synthetic reply failure and explicit retry left two
user messages and two assistant replies, not duplicate messages. Three synthetic
provider calls, no paid calls. Mobile Enter inserted a newline; the send button
sent deliberately. References opened their actual Principle and Back retained
the unsent draft. Opening a Principle-based composer still left one conversation.

The browser caught an expanded reference below the visible transcript; local
scroll adjustment fixed it, and the opened panel's bottom then matched the
transcript bottom at 736px. History and memory drawers, their focus return and
composer preservation were inspected. Keyboard viewport behavior was measured
with browser resizing/component events, not a physical-phone keyboard.

This is a UI/storage checkpoint, not completion of Milestone 1: adaptive reply
behavior and the live bilingual quality comparison remain pending the local
OpenRouter configuration. Milestones 2 and 3 remain open. The original reply
prompt and model selection are unchanged; no push or deployment has occurred.

After the interrupted turn, the fixture process was absent and port 3015 was
not listening. The remaining schema contained only the two known synthetic
fixture accounts and four test messages; it was removed explicitly. Current
web recheck: 700/700 across 98 suites, with web/API typechecks passing. This
checkpoint is committed before independent home-layout work begins; the live
reply-quality gate remains open, not silently passed.

### Milestone 2 home layout verification

Review and Talk with WAKA now have separate activity cards. Changes moved to
the reading header; Why remains attached to the reading. Resume and empty
states have distinct hints. Focused tests passed 20/20, then the full web suite
passed 702/702 across 99 suites; typecheck and build passed.

The built disposable fixture at 390 by 844 showed stacked 77px-high cards,
with Capture and Principles visible and no horizontal overflow. Talk with WAKA
opened `/chat/new`; Back returned home. This is automated navigation evidence,
not a human usability study.

The responsive gate failed at 320 by 568: cards occupied y282–444 and the
fixed-size companion overlapped them. The existing placement averages two
incompatible bounds when there is insufficient space. An experiment bounding
the reading to a scroll area removed the intersection but hid both activity
cards initially. That experiment was discarded, not accepted as a fix.

Milestone 2 remains unfinished and uncommitted. Next: provide coherent
short-screen scrolling without hiding the activities in a separate small
panel, then verify 320/390/768/1280 widths, long Korean/English readings,
empty/loading/error states and Review return navigation. Do not advance to
the memory milestone on the strength of passing component tests. The live
chat-quality gate still needs the OpenRouter configuration; no paid calls or
remote changes occurred.

### Milestone 2 responsive correction checkpoint

The short-screen overlap is fixed without shrinking the companion. A measured
space budget omits the decorative companion and peek orbs only when the reading,
activities and Capture cannot fit. Capture keeps a separate position above the
bottom controls. Long content scrolls in one reading/activity region below the
fixed navigation. On roomy screens the companion retains its existing size and
the cards remain beside each other on desktop and stacked on mobile.

Browser measurements: at 320 by 568, both cards are 67px high, the second ends
at y420 and Capture starts at y442. At 768 by 1024 and 1280 by 800, the two
85px-high cards sit side by side. At 390 by 844 they stack and the companion
remains visible. No horizontal overflow was measured. Long English and Korean
fixture readings scrolled 140px to reach both cards, while the reading region
stayed at y118 and the world root's scroll offset stayed zero. Review resumed
the saved session and closed home; Chat opened its dedicated composer.

Focus restoration exposed an additional issue: `overflow:hidden` let the world
root scroll 27px, displacing the navigation. `overflow:clip` now prevents that
outer scroll; the actual reading surface retains native scrolling and keyboard
focus. Empty-account and stale-reading recovery layouts were also inspected.
The loading shell was observed, not latency-tested.

Verification: web typecheck passed; full suite 705/705 across 100 suites; build
passed. The first full checks rejected two new variable names and a missing
test seam declaration; these were fixed rather than waived. A fixture update
first failed because its trigger needed an explicit schema search path; the
retry used the verified disposable schema. The original synthetic reading was
restored afterward. No remote data or model calls were used.

This is a local implementation checkpoint, not final goal completion. The
short human usability check remains open, as do Milestone 1's live adaptive
reply gate and all Milestone 3 implementation/calibration work. Browser evidence
is saved under `work/chat-home-memory/`; it is not a physical-device test.
