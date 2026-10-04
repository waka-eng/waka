# Personal UX clarity and safety

Status: done (2026-10-04), implemented and verified locally. Not pushed or deployed.
Branch: `codex/personal-ux-clarity`.

## Objective

Implement all eight improvements from the owner's UX review while preserving
the current visual feel. This is a local implementation and verification goal;
deployment, native packaging and unrelated earlier goals are not included.

## Gates

1. Safety and mobile layout: separate overlapping capture/review controls and
   inspiration metadata/privacy controls; replace ambiguous reflection deletion
   with explicit confirmation; explain the selected audience in visible and
   accessible text before saving or changing visibility. No silent publication.
2. Home and review: make capture primary, Principles unmistakable, and review
   resumption explicit before entry. Distinguish Browse, Reflect and Finish;
   preserve stored progress, drafts, navigation and current generation behavior.
3. Processing and chat: distinguish a successful save from scheduled reading
   work without promising a new artifact; keep compact visible save/correction
   actions and understandable citations with current-access checks.
4. Sharing: show a ready preview first, expose wording/customization on request,
   preserve every existing export, collection, historical wording and recovery
   capability. Card edits must not change saved Principles.
5. Verification: targeted regressions, full web tests, types/build, and actual
   desktop/mobile-width browser checks on isolated synthetic fixtures. Use no
   remote-account writes or paid model calls. Record limitations honestly.

## Log

### 2026 10 04 baseline

Live dev review found overlapping controls at 390px, a 27px home capture target,
ambiguous immediate reflection deletion, silent review resumption and unclear
scheduled processing copy. The prior completed milestone remains unchanged;
this goal tracks the new UX work separately.

### Implementation and verification checkpoint

All eight reviewed areas now have implementation changes. Home separates review
and chat from explanatory links, highlights capture and Principles, and reads
the active review without starting one. Review entry names resumption and the
selected count; the panel names Browse, Reflect and Finish. Scheduled notices
distinguish saved material, a scheduled reading, and earlier processing stages.
The normal scheduled-state check is secondary; failures still expose recovery.

Mobile shortcuts now share one responsive grid, rather than separately
positioned buttons. At 320, 390, 768 and 1280px, measured capture/review/search
bounds did not intersect. The 320px capture label wraps inside its target.
The reflected-source header puts metadata on a separate mobile row. Privacy
and reflection controls also receive 44px minimum heights. The later search
minimum-width correction and final button sizing still need rendered recheck.

Reflection deletion and publication use explicit inline confirmations with a
safe cancel action. Capture describes its selected audience, including the
private boundary of reflections. Component/route tests prove cancellation
sends no mutation and confirmation sends the intended one. Deletion remains
permanent after confirmation; no fictional undo or restoration is promised.

Chat keeps Save insight/Save thought and Correct reply visible in one compact
row. References include bounded current-access-checked excerpts and expand
beside their own message. A real isolated-SQL regression proves deleted
references lose their preview. Sharing starts with an exportable preview;
Edit wording and Customize are optional. Existing collection/change-card,
draft recovery and export contracts remain. The shared dialog keyboard loop
now excludes controls inside collapsed disclosures.

Checks so far: API typecheck and 766 unit tests passed (three paid benches
skipped); 16 conversation-reply SQL tests passed against the explicit loopback
test database. The last full web run before the disclosure-focus repair passed
687 tests. The initial runs caught obsolete translation copy and a missing
mock-layer declaration; both were fixed without weakening their gates. API
unit verification initially hit the system Git/Xcode license issue and passed
using the existing bundled Git, without accepting a license.

The synthetic browser run saved one private inspiration and one reflection;
SQL confirmed four total inspirations including three seeds, one reflection,
and the new inspiration still private. No paid calls or remote-account writes
were made. Desktop home, mobile capture audience, reflected-source header and
four-width shortcut geometry were inspected. This is browser-width evidence,
not a new simulator or physical-device pass.

At this checkpoint, interactive browser acceptance remained open. A native confirmation from
an intermediate build blocked the in-app browser's input handling; the tool
could neither expose nor dismiss that dialog. The owner was asked to cancel
it. Confirmation UI was subsequently moved inline for consistency with the
app, and its behavior passes component tests, but that does not substitute for
the remaining rendered checks. Completion was not claimed at that checkpoint.

At that checkpoint the disposable fixture was still running on 127.0.0.1:3015 for continuation,
using schema `waka_test_79eb0d2b810ec5ca` in `waka_capture_a03_test`. It must be
stopped and its exact schema cleanup verified after browser acceptance; that cleanup is recorded below.
Nothing from this goal has been pushed or deployed.

Final checkpoint checks: web typecheck, production build, all 688 web tests
across 96 suites, vocabulary, mock-seam and diff checks pass. The local
[private reflected source](../craft/evidence/personal-ux/private-reflected-source.png)
records the saved synthetic material; it predates the final 44px source-action
size adjustment and is not evidence that the remaining browser checks passed.

### Final acceptance on 2026 10 04

Browser access recovered and the remaining interactions were exercised. All
eight review findings are addressed within the agreed local implementation
scope; neither a redesign nor a generation-policy change was introduced.

| Review finding | Final evidence |
| --- | --- |
| Mobile overlaps | Final 320/390/768/1280px measurements: zero shortcut intersections, all controls inside the viewport; heights 44px except the wrapped 320px capture control at 54px. Metadata and privacy occupy separate mobile rows. Background shortcuts hide during dialogs. |
| Ambiguous reflection deletion | The inline confirmation explains permanent deletion and focuses Keep reflection. Cancel preserved the saved answer in the actual browser; component tests cover confirmed deletion and stale-follow-up invalidation. A discovered zero-gap button row was repaired and inspected again. |
| Audience clarity | Capture changes its visible audience explanation before saving. Opening publication confirmation left the source private; Keep private canceled it. Component/route tests cover the affirmative action. Reflections remain private. |
| Home hierarchy | Desktop/mobile screenshots show the primary capture action and legible Principles navigation, with review/chat separate from explanatory links. Key targets have the larger touch area. |
| Review resumption | One selection advanced Browse to Reflect; closing showed Resume review · 1 selected. Reopening showed Continue where you left off, and Finish review produced Review saved. SQL confirmed one completed session. |
| Processing clarity | A controlled future hold on the local fixture showed Saved and the scheduled time, without claiming a new reading. Details opens and exposes Check progress; expansion and focus survive rechecking. The browser caught gesture interception of summary clicks; data-jar-interactive fixed it, with regression coverage. |
| Chat density and references | One synthetic reply exposed Save insight and Correct reply together. The descriptive citation expanded inside its assistant message. Explicit rewriting/adoption saved one private inspiration. Cancel correction retained its unsent words; no extra message was sent. |
| Sharing complexity | Optional wording/customization controls opened and closed. Edited wording, a second Korean Principle, portrait/light styling and recorded change-card words rendered correctly. Reload preserved the selected change card. Returning to regular mode retained the edited collection. Tab skipped collapsed options and reached Save image. SQL confirmed the original Principle wording stayed unchanged. |

The browser's Save image action reported a download handoff, but its download
event observer timed out. A newly completed file transfer is not claimed. The
export transport is unchanged; existing tests still verify exact preview-blob
handoff, download failure recovery, native cancellation and no publication
claim. Native share sheets and physical devices were not requalified here.

Final checks: web typecheck/build and all 689 web tests across 96 suites passed,
including vocabulary, mock-seam and group-measurement gates. API typecheck,
766 unit tests (three paid benches skipped), and 16 isolated conversation-reply
SQL tests passed. No paid provider calls were made: the local walkthrough used
one synthetic conversation reply. No remote account, database or deployment
was changed.

Before cleanup, SQL showed five inspirations (three seeds plus two private QA
captures), one reflection, two conversation messages and one completed review.
Both private QA inspirations remained private. The dedicated server exited
cleanly; the exact fixture schema was then verified absent. Only agent-created
test tabs were closed, and the viewport override was reset. The user's dev tab
was retained. Disposable local test data was removed by the fixture cleanup;
the committed synthetic screenshots preserve the verification evidence.

Evidence: [home](../craft/evidence/personal-ux/home-desktop.png),
[scheduled work](../craft/evidence/personal-ux/home-scheduled-mobile.png),
[mobile header](../craft/evidence/personal-ux/mobile-final-layout.png),
[confirmation](../craft/evidence/personal-ux/reflection-confirmation-mobile.png),
[review stages](../craft/evidence/personal-ux/review-stages-mobile.png),
[chat](../craft/evidence/personal-ux/chat-actions-mobile.png),
[simple sharing](../craft/evidence/personal-ux/share-preview-mobile.png) and
[edited collection](../craft/evidence/personal-ux/share-collection-mobile.png).
Screenshots from earlier checkpoints may show background shortcuts before the
final dialog-hiding repair; the final confirmation image includes that repair.

A fresh fixture also verified that home search stays visible after the dock
change, opens normally, hides background shortcuts while open and returns on
close. Its search target measured 149×44px on desktop. The home screenshot was
updated from that fresh fixture. That server was also stopped; both exact test
schemas were verified absent. No test server is left running by this goal.
