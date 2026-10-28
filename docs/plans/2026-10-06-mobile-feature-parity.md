# Mobile consumer feature parity

Status: M1 inventory complete; selected iPhone journeys verified below. Full
platform acceptance and Android verification remain open.
Source baseline: dev `315328e` and the current shared React consumer app.

The matrix below defines acceptance cases. Sharing the UI alone does not mark
a native feature accepted. The separate admin application is outside scope.

| ID | Consumer feature | Acceptance on web iOS and Android | Native milestone |
| --- | --- | --- | --- |
| A01 | Signup and onboarding | Human account, language, onboarding and requested return route. | M2 |
| A02 | Password and Google sign-in | Success, rejection, cancellation, throttling and preserved destination. | M2 |
| A03 | Session and sign-out | Relaunch, expiry, revocation, identity switch and removal of scoped private state. | M2 |
| A04 | Profile and locale | Name/avatar/language edits persist; English and Korean render correctly. | M2/M5 |
| A05 | Public profile settings | Handle validation, opt-in switches, preview and public/private boundaries. | M2/M5 |
| A06 | Export and deletion | Export contents/download destination; confirmed deletion, cancellation and signed-out state. | M4/M6 |
| A07 | Sessions/connections | Inspect and revoke the intended connection while retaining others. | M2/M5 |
| C01 | Quick text and link capture | Original words/URL, selected profile, enrichment state and one saved original. | M2/M3 |
| C02 | Photos and camera | Single/multiple selection, capture/cancel, preview/orientation, format/size checks and denial recovery. | M3 |
| C03 | Recording and replacement | Start/stop/listen; five-minute limit; preserve prior clip until replacement is chosen. | M3 |
| C04 | Transcription and correction | Pending/ready/error, correction/retry and separate recording/transcription limits. | M3 |
| C05 | Mixed media and audience | Supported combinations and current server-controlled visibility/sharing rules. | M3/M5 |
| C06 | Drafts and uncertain saves | Relaunch/profile isolation, partial upload failure, expired ticket, duplicate tap and lost save response. | M3 |
| I01 | Field search/filter/detail | Current originals, dates, attachments, processing state and conversation origin. | M5 |
| I02 | Edit/remove original | Exact authored words, stale-version conflicts, confirmation/cancel and no resurrection. | M5 |
| I03 | Reflection conversation | Contextual questions, continued answers, scrolling, resumed drafts and reopened saved reflection. | M3/M5 |
| R01 | One-at-a-time Review | Start/resume selection, reflect, keep/skip, atomic Next, remove and finish/empty state. | M5 |
| R02 | Review evidence/results | Current source references, changed-source handling and processing outcomes. | M5 |
| T01 | Top of Mind and history | Current/versioned reading, why-this-read, evidence and loading/empty/queued/failed states. | M5 |
| T02 | Reading controls | Edit/lock/pin/dismiss/restore and explicit refresh with cadence/budget waits respected. | M5 |
| S01 | Patterns and evidence | Statements, original roots, feedback/restore and existing relation/duplicate controls. | M5 |
| P01 | Principles and feedback | List/status, wording edit, independent up/down order, contested state and restore. | M5 |
| P02 | Principle evidence and artifacts | Useful current examples, customized card/collection, preview, export/share and cancellation. | M4/M5 |
| Q01 | Chat history and lifecycle | Start/open/resume/delete, earlier messages, send/stop/retry and retained drafts/scroll. | M5 |
| Q02 | Chat context/citations | Clickable readings/principles, current/historical sources and changed/deleted memory. | M5 |
| Q03 | Corrections and capture from chat | Explicit correction, separately confirmed principle edit and owned saved thought/insight. | M5 |
| G01 | Existing rooms | Create/join/open/leave, membership/read errors and member/wall navigation. | M5 |
| G02 | Shared room memory | Share/unshare permitted signal statements; other members' raw evidence stays private. | M5 |
| G03 | Shared direction | Versioned direction, contributions/participation threshold, refinement/proposals and history. | M5 |
| M01 | Agent profiles | Create/rename/remove their own memory stacks and preserve human/profile boundaries. | M5 |
| M02 | Keys/grants/read record | Issue/reissue/copy/revoke agent/keeper keys, give/revoke sibling grants and inspect consultation record. | M2/M5 |
| U01 | Public profiles/deep links | Public opted-in content, unavailable states and owned destinations retained through login/Back. | M2/M5 |
| U02 | Copy/external destinations | Canonical web URLs, draft-word copying, safe external browser and touch equivalents for shortcuts. | M2/M4/M5 |
| U03 | Mobile layout/lifecycle | Keyboard-safe inputs, long-content scroll, safe areas, Back/rotation, resume/refetch and offline draft retention. | M3/M5 |
| U04 | Accessibility/preferences | Larger text, reduced motion, VoiceOver/TalkBack, focus and current locale. | M5 |
| U05 | Product explanations and pattern waiting states | Open the existing reading/how-it-works content, weather/antechamber information and global duplicate suggestions; preserve their current scope. | M5 |
| N01 | Share into WAKA | Supported incoming text/link/image becomes a durable unassigned or confirmed-profile draft. | M4 enhancement |

Source map: routes in `packages/web/src/main.tsx`; account, agent-key, keeper-key,
sibling-grant and read-record controls in `Profile.tsx` and Home's settings;
capture, reflection, Review, Principles and chat in their named components;
rooms, signals, timelines, search and wall navigation in `Home.tsx`; public
content in `PublicProfile.tsx`; current contracts in `src/lib/api/`.

Both native platforms currently have pending feature acceptance for these
cases in full. The existing web implementation/regressions are the comparison point;
each native integration must record platform/device/build evidence before its
status becomes accepted. Update this inventory as shared web functionality changes.

## iPhone verification — 2026-10-23

Device: iPhone 17 simulator, iOS 27.0 (24A434), Xcode 27.1. Source: dev
`07fbd135` plus the local fixes and tests from this pass. The M1 matrix above is
the original inventory; this pass follows the current UI, including Settings
and agent-owned archives, rather than removed settings/review/room screens.

The installed `im.waka.app.test` app used the real API against an explicitly
local, disposable Postgres database. All accounts, agents and content were
synthetic. Model workers were disabled; the reading, principle and assistant
reply were authored fixtures, so these checks do not verify live AI generation.

| Journey subset | iPhone result |
| --- | --- |
| Session restoration and account switch | Passed: capture/reopen, relaunch, sign-out, and a second account receiving 404 for the first account's inspiration. |
| Settings name | Passed: edit with the keyboard visible and retain the exact value after relaunch. |
| Inspirations | Passed: capture, edit exact words, search a populated archive, delete, restore the same ID, and reopen after relaunch. |
| Chats | Passed: read a seeded reply, resume an unsent draft after relaunch, persist a sent message, search history, cancel deletion, then delete. |
| Reading and principle | Passed: display the seeded reading, replace principle wording, save and reopen the exact wording after relaunch. |
| Agent profiles and keys | Passed: create, isolated inspiration/chat storage, key allow/deny/revoke, rename, cancel deletion, and confirmed deletion. The deleted profile's inspirations/chats were removed; human and sibling profiles and their inspirations/chats remained. |

Two small app fixes came from this pass: Settings now stays above the dock
when the keyboard reduces available height, and native links accept the retained
`/inspirations` and `/principles` redirects used by the web app. Targeted web
regressions passed (53 tests), mobile build-target checks passed (6 tests), and
both API and web typechecks passed.
The normal development iOS build also passed and was reinstalled. The final
agent lifecycle rerun passed after unlocking the Mac (`agent-unlocked.xcresult`,
one test, zero failures). All six journey subsets above now have passing native
results from targeted runs. Temporary test apps, schemas and databases were
removed after verification.

Native tests live in `packages/mobile/ios/App/FoundationTests/FoundationUITests.swift`.
Fixture setup is documented in `packages/mobile/README.md`; these feature tests
need `WAKA_MOBILE_FIXTURE_JOURNEYS=1` and a fresh fixture. Local result bundles,
screenshots and audit readbacks are under
`work/mobile-foundation/20261023-iphone-step2/` (ignored evidence files).

This is partial acceptance, not complete M5 or web/native parity. The media
checks below extend this core pass. Live model replies, real Google sign-in,
OS-verified HTTPS links, accessibility/rotation/offline coverage and
physical-phone behavior still need their own evidence. Android remains next.

## iPhone media verification — 2026-10-23

Four targeted media/recovery journeys now pass on the iPhone 17 / iOS 27.0
simulator. They used synthetic accounts, an explicitly verified disposable
loopback Postgres database and the local S3 stub. Model workers were disabled.
This verifies the app's upload/read contracts, not deployed S3 policy/signatures.

| Journey | Verified result |
| --- | --- |
| Photos | Cancel selection without losing words; select two photos; restore text/photos after background and relaunch; save and reopen both images. The large JPEG uploaded all 4,127,524 bytes. |
| Files | Cancel the picker; choose a synthetic text document from Downloads; restore the draft after relaunch; save and reopen its document link. Stored bytes match the fixture. |
| Recording | Backgrounding stops recording and saves an audio attachment with type/size; relaunch, play and pause the saved recording. |
| Failed save | A temporary API 503 retains the exact draft; retry succeeds; exactly one inspiration remains after relaunch. This does not simulate airplane mode or a lost response after commit. |

This pass corrected four gaps:

- Saved notes used the link-preview endpoint for their first photo and omitted
  recordings, documents and additional photos. They now reuse the attachment
  renderer with authorized read URLs, audio controls and document links.
- Archive recordings were finalized as generic files without a byte count.
  New recordings use the existing audio type and include their size.
- iOS permission purpose strings were missing. Camera, microphone and speech
  descriptions are present; recording denial guidance points to device settings.
- A restored large photo previewed correctly but sent zero upload bytes.
  Native drafts now store bytes directly in IndexedDB and reconstruct blobs on
  read. The web format is unchanged; the reader still accepts existing blob drafts.
  Copying picker files or materializing bytes only at upload time did not fix
  the failure and those attempted changes were removed.

Acceptance evidence is under `work/mobile-foundation/20261023-iphone-media/`
(ignored): `resume-photo3.xcresult` passes the photo journey;
`resume-media.xcresult` passes recording and retry, with an earlier file-selector
ambiguity; `resume-file.xcresult` passes the corrected file test. Screenshots and
final API/database readbacks are retained. Earlier failed/interrupted bundles
are diagnostic evidence, not acceptance results.

Validation: 102 retained media regression tests plus 36 draft storage/hook/logout
tests pass (138 tests across 12 files); six mobile target checks, API/web
typechecks, fixture iOS builds and the normal development iOS build pass.
Draft ownership, revision conflicts, settlement and large-file byte integrity
are exercised in both native and web storage formats.

The simulator starts WKWebView recording even after microphone access is
revoked with simctl. Real denial prompts/settings recovery, camera capture,
microphone quality, live speech recognition/transcription, airplane mode and
physical-phone behavior remain unverified. Android and live provider
authentication are still open.

The test app, temporary schema/database and synthetic Downloads files were
removed; fixture servers were stopped. The normal WAKA Dev build was restored.
No changes were pushed.


### Recovery UX follow-up — 2026-10-23

The shared web/native UI now retains the last agent roster on load failures,
offers confirmed discard for the active profile's draft, retries failed replies
without resending messages, and keeps archive search available at every size.
Human and owned agent archives use the same Undo and thirty-day recovery, including
attachments and corrected transcripts (migration `0080_deleted_attachments`).
Old deleted copies whose files were already swept still disclose that loss.
Password recovery remains deferred.

Validation: 1,329 web tests, 975 API unit tests (three skipped), 57 targeted
API/database tests, six mobile tests, typechecks, web build, migration checks and
the iPhone development build passed. Browser checks covered draft cancellation,
close/reopen, save, search, delete and restore. Evidence is in
`work/mobile-foundation/20261023-recovery/verification.json` (ignored).
Android APK verification is still pending: another build's Gradle distribution
download held the wrapper lock. Device Hub was concurrently controlling another
simulator, so native UI checks were stopped and the temporary WAKA test simulator
removed. Physical-phone installation remains deferred; no personal phone was
updated in this pass. Migration and changes have not been deployed.

### Reading and connection usability — 2026-10-28

Implemented across the shared web/native UI:

- The human Language setting synchronizes owned agents and requests a new
  reading for each changed profile. Agent creation locks the human profile
  before inheriting its language. Human-edited wording remains locked.
- Inactive profile walls are inert and hidden from the accessibility tree.
- Home has a compact Actions disclosure for Principles, available Review,
  and server-backed processing progress for the active profile. Progress
  distinguishes queued, scheduled, running and attention-needed work.
- Expanded Top of Mind includes the content update time, source patterns and
  inspirations loaded on demand, wording edits and feedback. Editing protects
  unsaved text when closing. Source links open the current inspiration page
  with Close, rather than the old floating orb card. No-change versions do not advance the
  content timestamp.
- API-key MCP setup prompts and manual configuration both target the current
  project. Browser-login setup retains its existing scope choices.
- Android declares the microphone permissions required by Capacitor's WebView
  capture implementation; microphone hardware is optional. No device permission
  was silently granted.
- Local journey timing distinguishes Home readiness, save acknowledgment,
  chat acknowledgment and actual reply observation; see the performance README.

Deferred readings now get self-deleting EventBridge Scheduler wake-ups after
the 24-hour hold or a budget deferral. PostgreSQL still enforces ownership,
due time, leases and budgets. Durable metadata recovers interrupted schedule
creation; bounded recovery batches arrange another wake when more may remain.
The daily safety sweep remains. This requires the new SST resources and IAM
bindings to be deployed; no schema migration was added or applied.

Verification used an explicitly selected disposable database on 127.0.0.1,
synthetic accounts, and disabled model generation. Web: 1,410 tests across 178
files; API unit: 998 passed, five skipped; 22 targeted database checks; seven
mobile contract checks; API/web typechecks, web build, migration consistency,
SST syntax and scheduler permission contracts passed. A legacy Review-link
routing assertion failed once during concurrent builds/tests; its 26-test
isolated rerun and the subsequent full web rerun passed. No routing code was
changed for that intermittent result.

At phone width, browser checks covered save/acknowledgment, reading editing,
unsaved-close protection, source disclosure/navigation, chat acknowledgment,
and processing status. The iOS 27 iPhone 18 Pro simulator installed and opened
the test build, displayed the reading edited in the browser, independently
found its saved inspiration in processing progress, and closed both reading
and progress sheets successfully. Android API 36 built and installed the APK,
but native UI automation could not bind the emulator window. Android journeys,
real microphone/permission recovery, and live provider reply timing are still
unverified in this pass. Earlier physical iOS mic acceptance does not establish
Android acceptance. No personal phone was updated.

Screenshots and timing receipts are in `work/improvements-20261028/`.
Temporary servers, the disposable database, the audit Android emulator and the
iOS test app were removed; the existing WAKA Dev installation was preserved.
These changes remain local; no push or deployment was performed.
