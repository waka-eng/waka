# WAKA iOS and Android app plan

Status: M1 and M2 accepted in simulator scope 2026-10-07. M3 is next and not
started. Registered signing and verified device links remain deferred until
device/beta delivery. Prepared 2026-10-06 against `dev` commit `315328e`.

Build iOS and Android apps with the existing React application inside Capacitor.
Keep the current design and full consumer web functionality, with native
integration for capture, files, sharing, authentication and app lifecycle.
Execute one milestone at a time, with a demonstrable result before continuing.

## Recommended architecture

Keep `packages/web` as the single source of screens, routes, styles, application
state and feature logic. Add `packages/mobile` for Capacitor configuration,
tracked iOS and Android projects, entitlements, build scripts and any small
native plugins. Build the same React source into each mobile application.
There is no need to introduce Ionic UI components or rewrite screens in Swift
or Kotlin.

Package compiled web assets inside release binaries and connect them to the
existing HTTPS API. Capacitor documents `server.url` as a development live
reload setting. A bundled release also lets the shell and draft UI open without
a network connection. Web deployment updates the website; installed mobile UI
updates initially ship through mobile releases. Backend improvements remain
shared. Live updates can be evaluated after the initial release.
[Capacitor configuration](https://capacitorjs.com/docs/config),
[deployment and updates](https://capacitorjs.com/docs/guides/deploying-updates).

Introduce a small platform module at the existing browser-dependent seams:

| Capability | Shared behavior | Native implementation |
| --- | --- | --- |
| Screens and navigation | Existing React routes, components and design | Back handling, keyboard, safe areas, launch/resume |
| Authentication | Existing accounts, human profiles and server sessions | Secure credential storage and OS sign-in handoff |
| Capture | Existing composer, preview, reflection and save identity | Camera, photo picker and microphone recorder |
| Files | Validation, attachment tickets and save reconciliation | Durable local file references and upload/download transport |
| Principles artifacts | Existing rendering and customization | OS share sheet and save/export destination |
| Incoming shares | Existing draft and capture flow | iOS Share Extension and Android share intents |
| Drafts and preferences | Existing ownership and revision rules | Persistent native metadata/files; lightweight preferences |
| Generation and chat | Existing API, jobs, citations and budgets | Resume/refetch behavior when returning to the app |

Components should call these capabilities without platform checks spread
throughout the UI. The web implementations remain available from the same
interface. Native credentials belong in Keychain/Keystore-backed storage;
ordinary Preferences is for small non-secret settings. Native draft files and
metadata need a durable store with ownership, revision checks and cleanup.
The storage choice is verified in M1 and implemented in M3. Capacitor warns
that mobile OSs can clear WebView localStorage; it must not be the sole durable
copy of a native capture. [Preferences documentation](https://capacitorjs.com/docs/apis/preferences).

## Findings that shape the work

The app already uses React, Vite and React Router. The main routes cover Home,
inspirations, Review, Principles and sharing, chat, account settings and public
profiles. They can be reused directly. Existing enabled rooms, profile and
agent-management surfaces remain in the parity inventory; this project does
not expand their product scope. The separate admin application is outside the
consumer mobile package.

The API supports a configurable base URL, but the browser client authenticates
with cookies. Session cookies use `SameSite=Lax`; packaged WebViews have a
different origin. Login already returns a session token, and the API accepts
Bearer sessions, which gives us a useful native authentication path. Audit all
HTTP entry points, including raw fetches in auth, attachments and reading,
instead of only modifying the shared JSON helper. Public links built from
`window.location.origin` also need a canonical WAKA web URL in native builds.

The existing isolated iOS probe verified photo selection, a share sheet,
synthetic recording and login retention. It also reproduced a failed Blob
upload with globally patched fetch. It uses a remote development page and
synthetic fixtures; it is evidence for individual integrations, not a
production shell or proof of packaged-app authentication. Android evidence is
currently from Chrome in an emulator, not an Android Capacitor build.

Current recording stops when the page becomes hidden, with a five-minute limit.
The documented attachment limit is 25 MiB and inline transcription limit is
12 MiB. Carry these distinctions into native capture: preserving an original
file does not guarantee it is eligible for transcription.

Sources: [earlier probe](../../tools/e2e/native-capture-spike/README.md),
[capture findings](../decisions/2026-10-02-audio-capture-spike.md),
[HTTP client](../../packages/web/src/lib/api/http.ts),
[auth client](../../packages/web/src/lib/api/auth.ts),
[draft storage](../../packages/web/src/lib/inspiration-draft-store.ts),
[recorder](../../packages/web/src/lib/use-audio-recording.ts).

## Milestones

### M1 Shared app foundation

- M1.1 Inventory every currently available consumer feature and record its web,
  iOS and Android acceptance case. Keep the matrix current as shared web work ships.
- M1.2 Add the mobile workspace and native projects using compatible stable
  Capacitor 8 packages. Verify plugin maintenance, licensing and SDK compatibility.
- M1.3 Add separate dev and production build configurations, app identities and
  API hosts. Dev and production apps should be installable side by side.
- M1.4 Establish the platform interfaces and shared build pipeline. Keep secrets
  out of bundled assets and disable release WebView debugging/live-reload settings.
- M1.5 Verify secure-storage, local-file persistence and OAuth handoff approaches
  in small tests before making them dependencies of the rest of the app.
- M1.6 Build and launch the actual bundled application on both simulators, with
  working routes, fonts, assets and an understandable offline launch state.

Acceptance: both native projects build from a clean checkout; the installed
apps load packaged assets and contact the intended API. The feature matrix and
integration decisions identify remaining work. No missing SDK/plugin issue is
left disguised as a completed platform.

Initial planning environment note: Node 22.22.3, Xcode 27.0 and ADB are present on this machine.
Android Studio/SDK and emulator locations still need verification; ADB alone
does not establish a working Android build environment. Simulator runtime
inventory did not complete during planning. Capacitor 8 requires Node 22+,
Xcode 26+ and Android Studio 2025.2.1+ according to its current
[environment guide](https://capacitorjs.com/docs/getting-started/environment-setup).

M1 result: both native targets build and launch with packaged assets. Android
SDK 36/JDK 21 and iOS 26.5/CoreSimulator 1171.7 are verified; native minimums are
iOS 17 and Android API 24. Storage/restart and app-side callback/replay checks
pass on both simulators. Android actual network denial and iOS controlled
failure/retry UI checks are distinct evidence. See the
[completion audit](../goals/capacitor-foundation.md) for exact limits.

### M2 Accounts networking and deep links

- M2.1 Support signup, password login, existing Google sign-in, session restore,
  expiry, revocation, logout and account/profile changes with the existing UI.
- M2.2 Store native session credentials securely and attach them only to the
  configured WAKA API. Keep attachment upload URLs free of WAKA auth headers.
  Preserve browser cookie authentication. Add narrowly scoped CORS support if
  WebView fetch is the selected JSON transport; test cancellation and timeouts.
- M2.3 Use the OS authentication flow for Google, then exchange a short-lived,
  single-use handoff code bound to the initiating app. Validate state, PKCE,
  redirect destinations and expiry. Never put reusable session tokens in URLs.
  Mobile sessions must belong to the human profile; the CLI agent login flow
  is not a substitute. Reuse existing server validation where appropriate.
- M2.4 Plan Sign in with Apple for iOS while retaining Google, subject to the
  applicable login-service requirements. Cover existing-account linking and
  private relay email without silently creating duplicate accounts.
- M2.5 Configure Universal Links/App Links and canonical public URLs. Preserve
  the intended destination through login and through cold or warm app launches.
  A private inspiration link still requires the correct account.
- M2.6 Exercise an authenticated slice on both platforms: log in, save text,
  reopen it, read existing memory, open chat, close the app and restore the session.

Acceptance: both platforms complete the authenticated slice; cancelled sign-in,
expired sessions, wrong-account links and logout behave correctly. Native and
web clients use the same account and profile boundaries. Auth-related database
changes, if needed for the handoff or Apple identity, have explicit migration
and rollback plans before rollout.

Google documents OS-browser authentication and PKCE for installed clients;
provider configuration must use the supported flow for each platform.
[Google authentication guidance](https://developers.google.com/identity/protocols/oauth2/native-app),
[Capacitor deep links](https://capacitorjs.com/docs/guides/deep-links).

M2 result: both native account/lifecycle slices pass. The owner confirmed live
Google login on Android; iOS OS-browser acceptance uses the simulated provider
and does not establish live Google identity acceptance on iOS. PRs 359/360 and
additive migration 0068 are deployed to dev, with 975 API unit, 1,744 hermetic
API and 857 web passes. Registered identities, device-verified associations,
iOS live-provider follow-up and store signing remain explicitly deferred.
See the [completion audit](../goals/native-accounts.md). Production is unchanged.

### M3 Native capture and durable drafts

- M3.1 Add native camera and photo-library selection behind the existing capture
  controls, with previews, multiple selections, cancellation and permission recovery.
- M3.2 Normalize orientation and supported photo formats, including HEIC input;
  strip unnecessary location metadata from generated upload copies and validate
  size/type before requesting an upload ticket.
- M3.3 Add a native recorder behind the current recording UI. Prefer a maintained
  compatible plugin; use a small owned bridge if required. Preserve playback,
  duration limits, transcription and transcript correction. Stop and preserve
  available audio on interruptions; background recording is outside the initial release.
- M3.4 Persist file references and draft metadata across suspension/relaunch.
  Keep account/profile isolation, revision checks, recording replacement and
  the existing save identity. Clean up files after save/discard/logout according
  to an explicit ownership and retention policy.
- M3.5 Validate native file transport with the current signed PUT upload contract,
  content types and size limits. Evaluate the official File Transfer API without
  assuming its default upload format matches S3. Cover lost responses, expired
  tickets, connection changes and retry without duplicate inspirations.
- M3.6 Recover Android camera results after activity/process recreation. Keep
  drafts accessible when offline and distinguish a local draft from a server save.

Acceptance: photo-only, audio-only, link-only and mixed captures save and reopen
on both platforms. Drafts and pending files survive tested lifecycle events;
denial/cancellation and upload retry preserve the user's input. Normal capture
and optional reflection continue through the same shared screens.

[Camera lifecycle guidance](https://capacitorjs.com/docs/apis/camera),
[File Transfer API](https://capacitorjs.com/docs/apis/file-transfer).

### M4 Sharing into and out of WAKA

- M4.1 Render Principles artifacts with the existing web code, then share the
  resulting file using the OS share sheet. Support saving/exporting files and
  cancelled shares. Do not report that a post was published merely because the
  share sheet opened. Preserve account export and existing copy-link actions.
- M4.2 Add Android share intents and an iOS Share Extension for supported text,
  links and images. This is a recommended native addition to make capture useful
  from browsers, Photos and other apps.
- M4.3 Keep the iOS extension small: copy the incoming payload into a durable
  App Group inbox and complete the extension request. Present the existing
  composer when the containing app can be opened or on its next launch; do not
  assume an extension can always launch the main app. Android similarly copies
  temporary shared content into app-owned storage before URI access expires.
- M4.4 Handle signed-out sharing, duplicate handoffs, multiple items and account
  switches. Hold unassigned captures locally until the user confirms the target
  profile. Reflection and processing run through the existing app/backend flow.

Acceptance: a supported share from another app reaches a recoverable capture
draft on each platform, including cold-start and signed-out cases. Outbound
artifact sharing and account export work with real local files. Incoming-share
work is distinct from Capacitor's outbound Share plugin.

[Capacitor Share](https://capacitorjs.com/docs/apis/share),
[Android incoming data](https://developer.android.com/training/sharing/receive),
[Apple Share Extensions](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/Share.html).

### M5 Complete parity and mobile experience

- M5.1 Complete the feature matrix: Home/Top of Mind and versions; Principles
  editing, order, feedback, restore, evidence and artifacts; inspiration detail
  and reflection; one-at-a-time Review and removal; chat history, citations,
  correction, retry and capture; search; account/profile/privacy/export/deletion;
  and currently enabled room, public-profile and agent-management functionality.
- M5.2 Tune safe areas, keyboard resizing, sticky composers, nested scrolling,
  touch targets, Android Back, iOS navigation gestures, rotation and larger text.
  Preserve WAKA's visual style and capture spark; add restrained haptics where useful.
- M5.3 Stop unnecessary polling while inactive. On return, revalidate the session
  and fetch existing job/conversation state without creating new generation work.
- M5.4 Test slow/offline connections, interrupted saves, process death, account
  switching and stale content. The first release supports durable drafts;
  server reads, AI generation and chat require connectivity. Full offline sync
  is a separate product capability.
- M5.5 Measure launch readiness, navigation, typing/scrolling, upload memory use
  and resume requests on both platforms. Compare against the shared web build
  under the same conditions; record device/runtime and network conditions.
- M5.6 Check VoiceOver/TalkBack, focus after native dialogs, text scaling,
  reduced motion and the keyboard. Keep accessible alternatives for gestures.

Acceptance: every in-scope feature has a passing web/iOS/Android result or an
explicitly accepted limitation. No unresolved blocker loses user input, crosses
profiles, duplicates saves or prevents a core journey. Shared web regressions
pass after introducing the native adapters.

### M6 Beta delivery and store release preparation

- M6.1 Configure signing, production identities, version/build numbers, icons,
  launch screens and reproducible iOS archives/Android App Bundles.
- M6.2 Add manually triggered native build/release workflows, retaining fast web
  checks on ordinary changes. Avoid running macOS builds on every commit.
- M6.3 Deliver to TestFlight and Google Play internal testing, starting with a
  clearly identified dev-backed build. Test an upgrade with saved drafts and
  existing sessions, then validate production configuration for release builds.
- M6.4 Keep API changes compatible with installed app versions. Record the mobile
  build, bundled web commit and backend compatibility expectations for each release.
- M6.5 Prepare store screenshots, descriptions, support/privacy URLs, permission
  copy, Apple privacy manifests/labels and Google Data safety disclosures.
  Validate account deletion in-app and the external deletion path required by
  Google Play. Audit public/room content against applicable moderation rules.
- M6.6 Review third-party AI data disclosures and consent before dispatch, and
  complete Apple login-service requirements. Existing web behavior alone does
  not establish store readiness. Submit public releases after beta acceptance.

Acceptance: signed beta builds install, authenticate, complete the core journeys
and upgrade successfully. Store metadata and account/data flows match the
shipped implementation. Public publication and store review are tracked
separately from successful build/upload; approval is not guaranteed by Capacitor.

Apple's guidelines address equivalent login options in 4.8, account deletion
in 5.1.1(v), and disclosure/permission for sharing personal data with third-party
AI in 5.1.2(i). Google Play requires account deletion paths inside and outside
the app where account creation is supported.
[Apple guidelines](https://developer.apple.com/app-store/review/guidelines/),
[Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en).

## Dependencies and working agreement

Use simulators/emulators for implementation and milestone demonstrations,
carrying forward the owner's earlier decision to defer physical-device tests.
Track real camera/microphone, lock-screen/call interruptions, Bluetooth audio,
low-memory behavior and OS share targets as physical-device follow-up. Recommend
closing those checks before a broad public release; simulator evidence remains
identified as such.

Confirm the Apple Developer/App Store Connect team, Google Play Console access,
production bundle/package IDs, Google/Apple sign-in configuration and signing
ownership before the stages that need them. These dependencies do not prevent
planning or unsigned local shell work. Recheck SDK and store submission
requirements when preparing release builds.

Defer push notifications, widgets, watch apps, background recording, biometric
app lock, full offline memory/chat and live web-bundle updates unless selected
as subsequent work. They are additions beyond current web feature parity.

The owner accepted M1 on 2026-10-06. Present both installed shells,
the parity inventory and the integration decisions at its checkpoint. Each
later milestone gets its own implementation, relevant tests and demonstration.
This planning change adds no runtime code, dependencies, schema, model calls
or deployment.
