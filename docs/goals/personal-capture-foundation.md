# Personal capture foundation

Status: in progress (2026-10-02), explicitly started by the owner.
Branch: `codex/personal-capture-foundation`, based on `59aab90` and the navigation/search work in PR #334.

## Objective

Complete the first bundle agreed in [the personal experience task list](../plans/2026-10-02-personal-experience-tasks.md): A01, A02, C01, C02 and A03. The exact acceptance criteria in that document remain authoritative. The older all-app backlog remains outside this goal.

## Owner decision on physical device verification

On 2026-10-02 the owner explicitly deferred actual iPhone/Android verification
to follow-up work. For planning, assume the implemented flows work on physical
devices, without treating that assumption as test evidence or a support guarantee.
The physical-device portions of A03 and related C01 checks no longer block the
first bundle or subsequent work. They remain unverified follow-up items; their
test cases and existing measurements are preserved. This decision supersedes
the physical-device blocking requirement in the original gates and historical
log below. It does not mark those tests passed or declare the whole goal complete.
The current request is documentation only; no new implementation is started.

## Gates

1. A01: document the ownership and mutation rules for raw capture, audio, transcription, reflection, review, conversation and exported cards. Work through a concrete example and amend the canon/glossary before adding identifiers.
2. A02: inspect desktop/mobile screen proposals for home, capture, inspiration detail, review, principle detail/sharing and avatar. Cover empty/loading/saving/error/return states and navigation. Design proposals for later features are not claims that those features work.
3. C01/C02: one composer accepts text, links, images and a recording, including attachment-only inputs. Save and continue-thinking use one durable save identity. The server confirms the inspiration and its requested attachments together. Failed upload/save retains the owned draft; response loss, retry and account change do not duplicate or disclose it. Verify meaningful API, persistence, component and browser cases.
4. A03: measure recording, playback, upload, permission denial and interruption on actual iPhone Safari and Android Chrome; evaluate Korean, English and mixed speech and record latency/cost/provider/format choices. Record a bounded Capacitor probe for recording, photo selection, sharing and login. Device emulation or a simulator does not satisfy the actual-device requirement.

The goal is complete only with evidence for every gate. Missing devices or provider access are explicit verification gaps, not grounds to reduce a gate. Continue independent work while gathering the missing evidence.

## Verification and cost

Use targeted API/web typechecks and tests, migration checks for schema changes, and real browser inspection. SQL mutations use explicitly selected disposable loopback Postgres; the current `.env.local` is remote Neon and must not drive tests or migrations. State a bounded call count and estimated cost before paid speech evaluation; stop if cost exceeds twice the estimate.

## Log

### 2026 10 02 baseline

- Active thread objective confirmed: complete the first bundle, with no token budget.
- Existing local app listens on port 3010; it uses the configured remote database, so synthetic verification needs a separate local fixture.
- Existing inspiration create requires nonempty text. Links are finalized after capture through a best-effort call; the two writes do not share the existing authored-save identity.
- Attachment types are link/image/file; audio MIME types and transcription are absent.
- `adb devices -l`: no connected devices. Xcode device inventory: the physical iPhone is offline. Available iPhone simulators are supplemental evidence only.
- Pre-change authored-save/reflection baseline: 30/30 tests passed across three suites.

### A01 contract

The data and action contract is in [capture foundation contract](../plans/2026-10-02-capture-foundation-contract.md), including one worked photo/link/audio/reflection/review/export example. Canon and glossary explicitly separate currently implemented memory from approved future review/conversation/export records. The same immutable save identity covers the attachment manifest, with a scoped durable draft and atomic row commit. A02 still needs inspected screen proposals; A03 still needs real-device evidence.

A01 verdict: pass. The required contracts, concrete example, canon amendment and vocabulary entries are present. This says nothing about implementation of later review/chat/sharing features.

### C02 server foundation in progress

Added an optional attachment manifest to inspiration create and audio enum values in migration 0049. Empty authored text is allowed only with an attachment. Uploaded-byte ownership, exact length and MIME metadata are verified before the transaction commits; unverified objects fail rather than claiming a saved attachment. The existing request hash includes the manifest only when supplied, preserving old text-only request hashes. Replays bypass object HEAD and load current owned rows.

Verified: 18/18 targeted unit tests (six new attachment cases); 23/23 disposable-loopback SQL tests (five new bundle cases and eighteen existing save/recovery cases). New SQL cases prove atomic rollback, response replay, manifest conflict, owner isolation and deletion tombstones. API/web typechecks and migration consistency check pass. No remote migration or real account mutation performed. C01/C02 remain incomplete until the composer, durable media draft and browser checks are connected.

Expanded API unit verification: 689 passed, three paid-live benches skipped. Bundle server foundation committed as `2a54db2`; this is partial C02, not the completed user flow.

### A02 screen proposal

Added the self-contained [screen proposal](../craft/personal-experience-prototype.html) and explicit route/Back/close contracts. Browser inspection: 36 desktop states and 36 states at 390×844; zero horizontal-overflow cases and no visible button below 44px high. The checks span home, composer, detail, review, principle/share and avatar, each at ready/empty/loading/saving/error/returning.

Interactive checks: empty capture disables save; adding the example attachment enables an attachment-only save; close/Back preserves edited draft text; changing card wording survives the simulated export without changing the original principle. Inspected [mobile composer](../craft/evidence/personal-capture/mobile-composer.jpg) and [desktop home](../craft/evidence/personal-capture/desktop-home.jpg). These are example-content design screens, not a functioning recorder, review, exporter or chatbot.

A02 verdict: pass for the agreed design deliverable. Actual microphone/device, backend connection, persistent media drafts and product browser journeys are still open under C01/C02/A03. An asynchronous user question asks whether actual iPhone and Android tests can be performed; independent implementation continues.

### A03 resource and evaluation checkpoint

The owner replied that physical-device testing is currently unavailable. The actual iPhone/Android gate remains unverified; no simulator or desktop result will replace it.

Before speech calls: six synthetic fixtures (English, Korean, mixed-language, a Korean time/duration statement, silence, tone) × two available Gemini models = 12 calls, no automatic retries, expected cost below USD 0.10 and an enforced USD 0.10 observed-token estimate cap. Predeclared local benchmark: normalized character error at most 5% for each speech clip; empty transcript for both non-speech clips. Latency and token/list-price estimates are reported. This fixture test does not establish noisy-recording or physical-device quality.

### C01/C02 connected web implementation

The production composer accepts text, detected/pasted links, selected/dropped
photos and one recording, with preview/removal and save/continue-thinking.
Owned IndexedDB drafts keep media bytes and use revision CAS. The existing
save journal awaits asynchronous settlement before clearing its record.
Upload-ticket issuance checks the requested profile before any file PUT;
private attachment reads check account/profile access and issue short-lived
URLs. Audio is stored, not silently described as transcribed or analyzed.

Browser evidence uses real Hono/auth/SQL against a disposable loopback schema,
with an in-memory S3 transport and synthetic microphone tone. Photo-only and
audio-only drafts survive reload; forced upload failure retains the photo;
lost successful-save response recovers one saved inspiration and opens its
reflection. A final combined text/link/photo/audio save produced exactly one
new inspiration, three attachments and one request record. Reopening the
private source displayed the image (natural width 1020) and played the audio
(readyState 4, paused false, no decoder error).

At 390×844 the live composer has no horizontal overflow and all eight visible
dialog buttons measure 44px high. Closing retains text and the draft reopens.
This is desktop browser responsive evidence, **not physical mobile touch**.
Screenshots: [composer](../craft/evidence/personal-capture/combined-composer.jpg),
[mobile-sized composer](../craft/evidence/personal-capture/mobile-live-composer.jpg),
[reopened attachments](../craft/evidence/personal-capture/saved-attachments.jpg).

Regression evidence: API unit 689 passed, three paid-live benches skipped;
web 483 passed across 71 suites, with vocabulary/seam checks clean;
targeted real-SQL suites 27 passed (18 saved-request, five bundle, four private
read/scoped upload). API/web typechecks, web production build and migration
consistency passed. Draft-hook tests additionally verify serial writes,
preserving newer edits on late success, and explicit fork after cross-tab CAS
conflict. Browser transport does not establish AWS signatures or policy.

C02 verdict: web implementation and recovery gates pass. C01 implementation
and desktop/responsive checks pass, but its explicit mobile-touch verification
remains open with A03. No remote data/migration, merge or deployment occurred.
The existing port-3010 server uses its earlier API process and is not evidence
of this new bundle; all new end-to-end checks used the isolated port-3015 stack.

### A03 measured result and resource limit

Twelve speech calls completed. Flash passed 6/6 fixtures; Flash Lite passed
5/6, failing Korean output by adding timestamps. Estimated combined cost
USD 0.0028286, below the announced USD 0.10 cap. Flash is the candidate for
later C06 integration; no production transcription worker was added.
See the [decision and raw result links](../decisions/2026-10-02-audio-capture-spike.md).

The bounded Capacitor iOS project builds successfully. Native UI could not be
tested because the Mac is locked; an unlock question is pending. The owned
simulator is `WAKA Capture A03` / `FA6EE0CE-83F9-413A-A43C-CC24BF114C80`, created
but not booted or installed. No attempt bypassed the lock. Actual iPhone Safari
and Android Chrome remain unavailable as confirmed by the owner.

Remaining first-bundle work is device verification: C01 mobile-touch flow,
A03 real microphone/permissions/interruptions/playback/upload, and the bounded
native photo/share/session probe. A01/A02 and C02 are complete; the full goal
is **not complete**. These resource gaps cannot be replaced with more desktop
unit tests or synthetic tones.

### A03 simulator access restored and C01 keyboard repair

The owner pointed out both simulators were installed. Android was found at
`/opt/homebrew/share/android-commandlinetools/emulator/emulator`, not the
default SDK location checked earlier. The iOS WAKA simulator and Android
`ondo_pixel` (API 35) both booted. Android uses `-read-only -no-snapshot-save`
to preserve its existing data. Mac native UI access now works. This supersedes
the earlier simulator-resource blocker, not the actual-device requirement.

iOS 26.5 Capacitor observations against a fresh disposable loopback database:

- Before login, session check returned 401; after fixture login, 200. Closing
  the app through the app switcher and reopening retained the matching session.
- Limited photo permission allowed only the generated fixture. The selected
  image rendered; the native file-share sheet opened and was canceled without
  external transmission.
- WebM/Opus tone recording played through the native audio control. The initial
  upload failed with `CapacitorUrlRequestError error 0` before the object PUT.
  Explicit `CapacitorHttp` base64 `dataType: file` fixed the native binary
  transfer. A 46,943-byte clip saved with 201; the same intent retried with 200.
  SQL/object counts remained one new inspiration, one attachment, one request,
  and one object. This change is in the native probe, not the production web
  transport. File size and MIME were verified by the real server HEAD check.

iOS simulator Safari also exercised the shipped web composer. Microphone
denial showed a recovery message without losing text; reload restored the
draft; save-and-think opened reflection. The Safari fixture unexpectedly used
the browser's real permission path rather than the injected synthetic getter;
permission was denied, and no host microphone was captured. Therefore only the
native probe recording above is claimed as synthetic-audio evidence here.

Keyboard testing exposed footer occlusion in centered writing dialogs. The
dialogs now track visual viewport resize/scroll; only capture and the standalone
reflection sheet opt into that positioning. Capture keeps its header/footer
outside the scrolling input area. After repair, both save buttons were visible
above the software keyboard; save-and-think worked with it open, and reflection
could be dismissed using its now-visible bottom action. Screenshots are
`ios-keyboard-capture.jpg` and `ios-keyboard-reflection.jpg` in the evidence folder.

Verification: targeted dialog/capture 14/14; web typecheck/build passed.
The concurrent full run had one navigation test time out at its existing
5-second limit, then five dependent failures. The same navigation suite passed
6/6 in isolation; full suite passed 484/484 across 71 suites with one worker,
without changing timeouts or assertions. Memory pressure was reported by the
Android emulator during concurrent runs; causality is not proven.

Android UI verification remains open: the running qemu window is not recognized
by the current native UI tool. An explicit request to use ADB touch/screenshots
is pending. Actual iPhone/Android microphone and interruption validation also
remain open. No production/dev data, deployment or paid model calls were used.

### Android Chrome emulator verification

The owner explicitly authorized ADB touch input/screenshots and completed the
Chrome first-run setup. The existing read-only Android 15 `ondo_pixel` emulator
accessed the isolated stack through `adb reverse tcp:3015 tcp:3015`.

Observed on the shipped web bundle:

- Text entry and synthetic recording start/stop worked. Reloading Chrome
  restored both text and the recorded WebM from the owned draft. Playback
  advanced to 0:11, confirming recovered bytes could be decoded.
- A deliberately failed object PUT showed "Couldn’t upload this attachment.
  Your draft is still here. Try saving again." and preserved the input.
- On retry, the fixture deliberately dropped the successful create response.
  The app reconciled the original save and opened reflection for the entered
  words, without a second source or save request.
- The Android system photo picker selected only the generated fixture PNG.
  The Link action accepted the synthetic example URL and displayed it beside
  the photo. The combined save committed one source with image and link rows.

Counts before/after the two Android saves: inspirations 4→6, attachments 1→4,
save requests 3→5, objects 1→3. Direct SQL in the disposable schema confirmed
the first source has exactly one audio attachment and the second exactly one
image and one link. No other account or remote database was used.

Evidence: `android-draft-restored.png`, `android-upload-retry.png`,
`android-save-recovered.png`, and `android-photo-link.png` under the capture
evidence folder. No product-code changes were needed for these Android cases.

After the final save committed, the emulator process ended with exit 137 and
ADB disconnected. Its process handle and device inventory both confirmed
termination. Earlier memory-pressure warnings exist, but the cause of this
termination was not established. The last combined save is proven by SQL;
reopening that source on Android after termination was not verified. The
read-only emulator was not silently restarted or reset.

The ADB approval blocker is resolved. The tested emulator paths pass, but
actual iPhone/Android microphone capture, physical permissions/interruption
behavior and real-device quality remain outside this evidence. A03 and the
full first-bundle goal are still not complete.
