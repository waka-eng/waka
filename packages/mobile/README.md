# WAKA mobile workspace

The apps package the shared React source in `packages/web`. This workspace owns
Capacitor configuration, native projects, OS bridges and build commands. M1
acceptance is tracked in [the goal](../../docs/goals/capacitor-foundation.md)
and [the parity inventory](../../docs/plans/2026-10-06-mobile-feature-parity.md).

## Commands

Use Node 22+, Xcode 26+ with an available simulator runtime, Android SDK 36 and
a compatible JDK (21 recommended). `pnpm mobile:doctor` checks the installed
tool locations. `JAVA_HOME` and `ANDROID_SDK_ROOT` can select another toolchain.
Native targets use iOS 17+ and Android API 24+, matching the selected native
dependencies; the installed simulator versions are recorded separately.

```sh
pnpm install --frozen-lockfile
pnpm mobile:doctor
pnpm --filter @waka/mobile build:ios:dev
pnpm --filter @waka/mobile build:android:dev
```

Run builds sequentially: both native projects consume the selected `www` bundle.
Each build first compiles/syncs the shared app. Receipts are under `.build/`;
Android APKs are in `android/app/build/outputs/apk/`. Install the App.app/APK
with the simulator SDK, or open the native project in Xcode/Android Studio.

| Target | Identity | API | Native variant |
| --- | --- | --- | --- |
| Development | `im.waka.app.dev`, WAKA Dev | `https://dev.waka.im` | iOS Debug / Android debug |
| Production | `im.waka.app`, WAKA | `https://waka.im` | iOS Release / Android release |

`build:ios:prod` produces an ad-hoc-signed simulator app with app-scoped Keychain
entitlements (not a device/store signature); `build:android:prod`
produces an unsigned release APK. The identities are proposed local identities;
store registration, archives/App Bundles and production signing remain M6.
Different IDs allow side-by-side installation and separate protected storage.

## Assets and configuration

The app loads packaged assets. Mobile Vite builds disable dotenv loading and
expose only explicit public settings; inherited sensitive values are checked
against emitted source without printing them. Production output excludes the
development diagnostics module. Sync refuses a different bundle target, and
Android checks the selected native variant against its packaged metadata.

WAKA's existing font families are packaged locally, including Korean glyphs.
License texts are included in `www/licenses`. Native source/project files are
tracked. Compiled assets, dependency paths, caches and local signing state are
generated/ignored. Web deployment and installed mobile UI releases have separate
build artifacts while retaining the same source.

## M1 integration checks

Dev builds expose `/mobile-check` for synthetic credential/file write, read,
cleanup, font and API-health checks. Reports live in private `waka/m1` storage.
Dev links use `im.waka.app.dev://diagnostics/check?phase=write`, `phase=read`
and `phase=cleanup`. A pending callback attempt is encrypted; its URL carries
only a short-lived code and state. iOS can require an Open confirmation for an
external scheme handoff. M2 adds the actual server exchange/provider sign-in.

Protected storage uses an owned iOS Keychain bridge with a bundle-specific,
device-only service and Android Keystore AES/GCM with private ciphertext and
authenticated key names. Failure never falls back to plaintext. Files use
Capacitor's Data directory. Owner-scoped draft integration and retention remain
M3; native session transport remains M2; native capture/sharing and full consumer
journey acceptance remain visible in the parity inventory.

## Isolated native account fixture

M2 journeys use `im.waka.app.test`, separate from both normal app identities.
The explicit fixture build targets only port 8787 on the simulator's host
loopback; it cannot produce a production/release target. No remote frontend is
loaded. The fixture server refuses non-loopback/non-test databases, disables
model workers, uses synthetic accounts, and removes its owned schema on exit.
Its simulated Google page proves browser/code delivery, not live provider login.

```sh
DB_CONNECTION_URL=postgresql://agi@127.0.0.1:5432/waka_mobile_m2_test_20261007 \
  WAKA_MOBILE_FIXTURE_RUN=1 pnpm --filter @waka/api exec tsx test/mobile-fixture.mts
WAKA_MOBILE_FIXTURE_PLATFORM=ios pnpm --filter @waka/mobile build:ios:dev
WAKA_MOBILE_FIXTURE_PLATFORM=android pnpm --filter @waka/mobile build:android:dev
```

Create your own empty local test database first; the example names this
machine's disposable database, not dev data. Install the generated fixture
binary and use its ordinary login/capture UI. Normal dev/prod commands keep
their HTTPS API origins and do not enable fixture cleartext policy.

For the iOS `AccountsUITests` feature journeys, also set
`WAKA_MOBILE_FIXTURE_JOURNEYS=1` on the fixture server. This adds a searchable
archive, a reading, a principle and a conversation with an explicitly synthetic
reply. These exercise display and persistence without model calls. Start a fresh
fixture for each suite run; tests edit and delete their own synthetic data.
Use `-parallel-testing-enabled NO -collect-test-diagnostics never` with
`xcodebuild test` and the `FoundationChecks` scheme. XCTest still retains failure
screenshots; disabling verbose simulator diagnostics avoids long sysdiagnose
collection after an assertion fails.

Media journeys additionally need the local object-store stub. Start it on a
free loopback port (for example `pnpm tsx tools/e2e/s3-stub.ts --port 8794`),
then pass `ATTACHMENTS_BUCKET=waka-mobile-media-test` and
`ATTACHMENTS_ENDPOINT=http://127.0.0.1:8794` to the fixture server. Use a dedicated
simulator with synthetic/sample photos only. The photo test selects the first
two images; one should be several megabytes to cover restored file uploads.
The file test downloads `/api/mobile-fixture/sample.txt` through Safari into
On My iPhone/Downloads. The fixture's `/network` control returns a temporary 503
for writes; it tests failed-save recovery, not the OS's airplane-mode behavior.
The simulator does not reliably enforce microphone denial for WKWebView, so
permission prompts and denial recovery still require a physical iPhone.

The official Keyboard 8.0.6 plugin (MIT) resizes the native WebView when typing;
Android uses `adjustResize`. This keeps sign-in controls above the keyboard.

## Public link associations

Native configurations declare stage-specific consumer HTTPS paths; API/OAuth
callback paths are excluded. Website verification still requires registered
Apple identifiers and the actual Android signing certificate, not simulator
identities or a temporary test key.

```sh
WAKA_APPLE_TEAM_ID=YOUR_TEAM_ID WAKA_ANDROID_CERT_SHA256=YOUR_CERTIFICATE_SHA256 \
  node packages/mobile/scripts/link-associations.mjs development
```

This validates public signing identifiers and emits stage-specific documents in
`.build/links-development/.well-known/`. It does not publish or modify the shared
web public directory. Serve both files as JSON at the same stage domain without
SPA fallback. The native code/association document is preparation, not evidence
that the OS has verified the link; complete OS verification after registration
and an approved deployment.
