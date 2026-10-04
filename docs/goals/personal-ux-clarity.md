# Personal UX clarity and safety

Status: in progress (2026-10-04).
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

Final interactive browser acceptance remains open. A native confirmation from
an intermediate build blocked the in-app browser's input handling; the tool
could neither expose nor dismiss that dialog. The owner was asked to cancel
it. Confirmation UI was subsequently moved inline for consistency with the
app, and its behavior passes component tests, but that does not substitute for
the remaining rendered checks. Do not mark this goal complete yet.

The disposable fixture is still running on 127.0.0.1:3015 for continuation,
using schema `waka_test_79eb0d2b810ec5ca` in `waka_capture_a03_test`. It must be
stopped and its exact schema cleanup verified after browser acceptance.
Nothing from this goal has been pushed or deployed.

Final checkpoint checks: web typecheck, production build, all 688 web tests
across 96 suites, vocabulary, mock-seam and diff checks pass. The local
[private reflected source](../craft/evidence/personal-ux/private-reflected-source.png)
records the saved synthetic material; it predates the final 44px source-action
size adjustment and is not evidence that the remaining browser checks passed.
