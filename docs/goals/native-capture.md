# Native capture and durable drafts

Status: paused by owner (2026-10-07) to prioritize web quality. M3 remains on the roadmap; M4 sharing and store delivery remain later work.
Branch: `codex/capacitor-m3`, based on dev `043b07ec`.

## Objective

Deliver M3.1–M3.6 from the [mobile plan](../plans/2026-10-06-capacitor-mobile-plan.md).
Reuse the existing composer, reflection, account/profile boundaries and upload/save
identity. Native capture must preserve user input across lifecycle changes, not
depend on WebView storage as its only durable copy. Keep the web path unchanged.

## Gates

1. Durable native drafts: app-owned files/metadata, owner isolation, revision
   conflicts, recording replacement and save/discard/logout retention rules.
   Failed writes cannot replace the last committed draft or report success.
2. Photos: native camera and multi-photo picker with previews, permission recovery
   and cancellation. Normalize orientation/HEIC and remove unnecessary location
   metadata from upload copies. Validate type/size before requesting upload tickets.
3. Audio: native recording with playback, five-minute limit, interruption recovery
   and a durable original. Keep transcription and correction behavior. Never start
   background recording or discard the previous clip before replacement is chosen.
4. Upload/save: signed PUT has exact content type/bytes and no WAKA credentials.
   Evaluate native File Transfer against that contract. Lost responses, expired
   tickets and retries preserve input and do not duplicate inspirations.
5. Lifecycle: recover Android activity camera results; drafts/files survive
   suspension/relaunch and offline composer use. Local draft is not a server save.
6. Acceptance: photo-only, audio-only, link-only and mixed captures save/reopen on
   both simulators through the normal shared UI. Verify cancellation/denial/retry,
   owner switching, cleanup, web regressions and native build target guards.

## Verification boundaries

Use explicit disposable loopback Postgres and isolated `im.waka.app.test` builds.
Do not operate on the owner's signed-in dev account for destructive or synthetic
tests. Physical microphone/camera, calls/lock screen, Bluetooth and real low-memory
behavior remain physical-device follow-ups under the existing owner decision.
Do not treat synthetic audio as evidence for physical microphone fidelity.
No production deployment, store setup or new sharing-extension scope is implied.
Any paid model test must fit the owner's existing USD 5 evaluation authorization;
first use deterministic/local fixtures with model workers disabled.

## Phases

1. Add the native draft persistence seam and failure/ownership/CAS tests; integrate
   without changing browser IndexedDB behavior. Then verify actual native storage.
2. Add native camera/picker/normalization and Android restored-result handling.
3. Add compatible native recorder, interruption handling and durable replacement.
4. Complete upload transport, retirement/cleanup and recovery tests.
5. Run both native capture journeys and shared web regressions; audit all six gates
   and stop at the M3 checkpoint.

## Log

### 2026 10 07 web quality priority

The owner requested retaining native work on the roadmap and focusing on web
application quality. Pause M3 implementation and preserve the existing branch,
commits, fixture receipts and uncommitted recovery changes. The recorder
dependency is installed but native recording is not integrated or accepted.

The last chat reported two successful Android camera process-death recoveries
and 884 passing web cases. Those results have not been rerun in the recovery
chat, and the latest recovery fixes remain uncommitted. Resume by reviewing
those changes and receipts, finishing the photo gate, then recording,
upload/save/offline retention and both-simulator acceptance. No remaining gate
is waived. Web priorities are recorded in the
[web quality roadmap](../plans/2026-10-07-web-quality-roadmap.md).

### 2026 10 07 start

Current composer already supports previews, a single replaceable recording,
five attachments, upload retries and revision-based save reconciliation. Its
durable media draft uses IndexedDB. Capacitor Filesystem is installed, but its
text-only M1 contract does not yet own capture files. Start with native durable
storage so later picker/recorder results can enter the same existing draft flow.

### 2026 10 07 phase 1 durable storage foundation

The shared draft operations select app-owned file storage for mobile and retain
IndexedDB for web. Native writes persist immutable media first, then publish a
new revision manifest by renaming a temporary file. A failed publication leaves
the prior commit intact. Text changes reuse unchanged bytes; exact-revision save
settlement publishes a tombstone before retiring media. Ownership includes both
account and profile, and file references cannot cross their draft directory.

Baseline draft/composer/audio/upload checks pass 38/38. Eleven new backend cases
cover restart, owner isolation, concurrent/stale revisions, IO failure/retry,
recording replacement, settlement/resurrection, cleanup failure, path rejection,
truncated bytes and invalid selections. Two dispatch cases prove mobile never
silently falls back to IndexedDB. The initial broad check rejected a folder token
using old vocabulary; `inspiration-drafts` fixes it without an allowlist change.
A second seam-header failure required naming the exact replaced modules.

Installed `im.waka.app.test` diagnostics verify text, an unfinished link and exact
synthetic binary bytes after process termination on Android and iOS, with the API
stopped. Profile-isolation and settlement checks pass. The iOS XCTest has one
pass, zero failures and zero runtime warnings after establishing the driver's
application session before URL delivery. The failed first receipt reports
“Application 'im.waka.app.test' has not loaded accessibility”; the native write
had succeeded. Both receipts remain under `work/mobile-foundation/`.

Final checks pass 870 web cases across 119 suites, six mobile policy cases,
web types and whitespace. Both fixture native builds and the production bundle
guard pass. This proves
storage/dispatch, not camera, playable recording, actual uploads, logout cleanup
or the full offline user flow. Gate 1's remaining retention/lifecycle work is
still open for phase 4. In particular, the existing Home demo-only offline save
branch must not clear a real native draft or imply a server save. Native auth's
network-failure behavior also needs a deliberately scoped offline-draft path.
No dev/production data, schema, model calls, push or deployment changed. The
owner's signed-in WAKA Dev app was not reinstalled or signed out.

### 2026 10 07 phase 2 photo dependency selection

Start native photos with pinned official Camera 8.2.5 in both workspaces. Its
published package declares MIT and Capacitor core >=8; include its license in
native bundles. Use current `takePhoto`/`chooseFromGallery`, not the deprecated
entry points, per the [Camera API](https://capacitorjs.com/docs/apis/camera).
Plugin installation is only a prerequisite: UI wiring, normalization/metadata
removal, permissions, restored results and native photo acceptance remain open.

The [File Transfer API](https://capacitorjs.com/docs/apis/file-transfer) defaults
to multipart; raw-stream upload needs explicit content type. Its compatibility
with signed PUT and cancellation must be measured in phase 4 before selecting
it. Preserve native save identity beyond WebView-only journals as part of that
lost-response/restart audit. No paid provider calls have been made.

### 2026 10 07 phase 2 photo implementation continuation

The existing composer exposes native Camera/Photo controls without changing the
web file-input path. A protected request binds returned files to its original
account/profile/draft. Results are copied into an app-owned inbox, normalized,
then appended with stable identifiers. Newer words are retained; repeat delivery
does not duplicate media. Pending selections distinguish returned bytes that
can be recovered from interrupted choices that must be chosen again.

Still-image copies use ImageIO thumbnail transforms on iOS and Android
ImageDecoder (BitmapFactory/EXIF on older Android). They re-encode pixels without
copying source location dictionaries; PNG alpha is retained and GIF animation
is kept. Actual HEIC/orientation/GPS corpus checks remain open.

Android's current Camera gallery API returned absolute paths and left a library
loading activity visible in the first real picker attempt. Its activity launchers
keep currentCall only in memory. Android therefore uses an owned PhotoFiles
saved-call picker/camera bridge with nonce echo and original URI grants, avoiding
eager JPEG conversion. iOS uses its native gallery API and existing camera
handoff. Controller cancellation, copy/publication failures, wrong owners,
duplicate callbacks and URI normalization are tested.

The real Android system picker returns the synthetic fixture to the normal
composer as a normalized PNG preview and durable bytes. The inbox is cleared
after adoption; two intentional selections appear as two rows. An adopted photo
survives process kill/relaunch. The stronger outstanding-result experiment is
NOT a pass: am kill left the visible/paused app alive; scoped SIGKILL killed it
but Android discarded the picker task and delivered no result. The setting
attempt did not destroy the paused activity (mHaveState=false); its original
always_finish_activities=null was restored. Full-screen camera saved-state
recreation still needs direct acceptance. Evidence remains under
work/mobile-foundation/m3-android-*. No existing draft bytes were lost.

Both native fixture targets compile after correcting the Android executor call
and Swift bridged-method array annotation. Broad web checks pass 881 cases
before the last composer test. The iOS picker, camera permissions/cancellation,
metadata corpus and Android camera restoration remain open. Phase 2 is not
accepted; phases 3–5 have not started. All data is in the explicit local fixture.
No model calls, remote schema changes or deployment occurred. The owner's
signed-in dev app remains unmodified.

### 2026 10 07 photo codecs and iOS selected access

Synthetic ImageIO fixtures contain orientation 6 and fake GPS metadata in JPEG,
HEIC and PNG. The real native decoders initially produced correctly rotated
JPEG/HEIC copies but did not rotate PNG eXIf data on either platform. Explicit
PNG transforms correct this. Both native reports now pass 3/3: source 12x8
becomes 8x12, orientation is normal, GPS is absent and measured byte counts match.
The failing reports are preserved alongside passing reports under
`work/mobile-foundation/m3-*-codecs*.json`. This corpus does not yet prove every
mirrored orientation or actual PNG transparency; those checks remain visible.

Installing iOS exposed a packaging failure hidden by compile success: global
PRODUCT_BUNDLE_IDENTIFIER/INFOPLIST_FILE overrides gave IONCameraLib the app's
identity and plist. App-only WAKA_APP_* settings fix the app, plist and signing
scope. IONCameraLib's own identifier is restored, and the fixture installs.
Seven mobile policy cases, including the new override regression, pass.

The iOS library chooser requested full Photos access. Replace that path with
owned PHPicker selected-file access and preserve original representations in
the durable request inbox. With Photos permission reset on `im.waka.app.test`,
native opening/cancellation passes. Two explicitly seeded photos are selected,
previewed and restored after process termination in the normal composer. The
selection XCTest passes 1/1, as does the separate cancellation case. The former
coordinate failure and post-restart selector failure are retained: drawable
Photos AX leaves require centre coordinates, and a stored draft changes the
Home CTA to “Continue your draft”. The final case asserts the exact additional
media count, not the mere presence of pre-existing photos.

Current web regressions pass 882/882. No server save/upload or paid model call
was used for these checks. Android full-screen camera restoration, camera
permission/cancellation acceptance, the remaining codec edge cases and phases
3–5 are still required. Phase 2 remains in progress; do not mistake compile,
gallery or codec acceptance for complete M3 acceptance.
