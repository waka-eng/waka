# Web quality and intuitive use

Status: in progress (2026-10-07). Implement all batches in the web quality roadmap.
Branch: `codex/web-quality`, based on dev `043b07ec`.

## Objective

Implement the [web quality plan](../plans/2026-10-07-web-quality-roadmap.md),
prioritizing simplicity and intuitiveness. Keep the entire five-batch objective:
baseline/prototypes, Home/Capture, return visits, reliability/AI usefulness and
human/operational acceptance. Native capture stays paused in its own checkout.

## Gates

1. Baseline: inspect the current built app at desktop and narrow widths, with
   fresh/returning/large synthetic profiles; record reachable actions, task steps,
   screenshots and failures. Prototypes must address specific observed friction.
2. First minute: one obvious Capture/Continue-draft action, stable labeled
   navigation and a helpful empty state. Plain text saves without choosing
   reflection. Audience stays visible; failed/uncertain saves preserve input.
3. Return visits: Review separates normal navigation from deletion; evidence,
   corrections and optional chat operations are progressively disclosed.
   Search, copied links and Back restore the intended item/place. Keyboard,
   touch, narrow layouts and both supported locales remain usable.
4. Dependability/usefulness: exercise write-boundary failures with no input loss
   or duplicate writes; measure deployed timing separately from local fixtures.
   Compare raw-capture-to-reading/chat quality against identical baseline cases,
   preserving the existing >=90% qualitative bar and critical safety cases.
5. Human/operations: observe the five first-time tasks without coaching and
   report completion/help/wrong turns. The proposed target is 4/5 unaided for
   each task with no accidental public share or deletion through navigation.
   Verify exercised deployment recovery/alerts, provider/source policy and actual
   recurring spending controls. Missing human/cloud evidence keeps this open.

## Verification and limits

Use targeted API/web checks and real built-browser journeys. Database writes
use an explicit disposable loopback database and synthetic identities. Model
networking is disabled for initial UI work. Reconcile the existing USD 5
evaluation ledger before any paid batch; unknown dev charges remain reserved.
Production, real-account mutation and provider administration are separate
actions. User authorization to implement all removes per-batch approval pauses.

## Log

### 2026 10 07 start

The previous planning turn made progress: it saved the detailed implementation
plan and recorded native deferral. The owner now requests implementing all.
Verified origin/dev and local dev both resolve to `043b07ec`; created a managed
worktree and `codex/web-quality`. The native checkout and uncommitted changes
remain present. Dependencies install from the unchanged lockfile.
Baseline/prototype gate starts with the existing real-auth/Hono/SQL fixture.

### 2026 10 07 baseline and prototype gate

Built dev `043b07ec` with real authentication/Hono/SQL, deterministic provider
fixtures and an explicitly verified loopback database. Six desktop/390px walks
cover an empty profile, a three-inspiration returning profile and a 2,000-item
archive. Draft return passes 6/6. All six composers expose two completion
choices, Save and Save & think further. The empty profile exposes Review even
though its hint says to save first; Inspirations has no visible empty-archive
entry. Principles and the archive move between section-specific signposts.

The [Home/Capture prototype](../craft/evidence/2026-10-07-web-quality-prototype.html)
proposes a stable labeled navigation row, a focused empty state and one Save
completion action. It is a design artifact, not application acceptance evidence.
Current screenshots and measured inventories are under `work/web-quality/baseline`.
Verdict: baseline/prototype gate passes; first-minute implementation is next.

Retained failures: the first driver used wrong case for Continue your draft
and timed out; corrected the selector without changing the draft assertion.
A fixture seed initially omitted schema search_path, so its trigger rejected
the statement; the explicit loopback schema retry inserted exactly 1,997 rows.
No provider or hosted-account calls were made.
