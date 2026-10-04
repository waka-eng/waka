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
