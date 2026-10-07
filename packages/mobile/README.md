# WAKA mobile workspace

The apps package the shared React source in `packages/web`. This workspace owns
Capacitor configuration, native projects, OS bridges and build commands. M1
acceptance is tracked in [the goal](../../docs/goals/capacitor-foundation.md)
and [the parity inventory](../../docs/plans/2026-10-06-mobile-feature-parity.md).

## Commands

Use Node 22+, Xcode 26+ with an available simulator runtime, Android SDK 36 and
a compatible JDK (21 recommended). `pnpm mobile:doctor` checks the installed
tool locations. `JAVA_HOME` and `ANDROID_SDK_ROOT` can select another toolchain.
Native targets use iOS 16+ and Android API 24+, matching the selected native
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

`build:ios:prod` produces an unsigned simulator app; `build:android:prod`
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
