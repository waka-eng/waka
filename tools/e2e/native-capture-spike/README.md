# Isolated Capacitor capture probe

This is an A03 experiment, not a shipping mobile app. It uses generated tone
audio and a disposable local account. Never point it at dev/production or enter
real credentials. iOS simulator UI was exercised; physical-device checks remain outstanding.

## Reproduce

1. Build the web app. From the repository root, run
   `DB_CONNECTION_URL=<explicit-loopback-disposable-test-url> pnpm tsx tools/e2e/capture-foundation-preview.ts`.
   The fixture rejects non-loopback/non-test databases and creates its own schema.
2. In this directory run `pnpm install --frozen-lockfile`, `pnpm run build`,
   then `pnpm exec cap add ios` on a fresh checkout and `pnpm run sync`.
3. In the generated `ios/App/App/Info.plist`, add the following keys with
   descriptions appropriate to the fixture: `NSMicrophoneUsageDescription`
   (test voice note), `NSCameraUsageDescription` (fixture photo),
   `NSPhotoLibraryUsageDescription` (choose fixture photo), and
   `NSPhotoLibraryAddUsageDescription` (save generated test card).
   Set `NSAppTransportSecurity.NSAllowsLocalNetworking` to `true` for the
   loopback fixture. Do not add global insecure-network exceptions.
4. Build with `xcodebuild -quiet -project ios/App/App.xcodeproj -scheme App
   -sdk iphonesimulator -configuration Debug -derivedDataPath ios/build
   CODE_SIGNING_ALLOWED=NO build`.

The dev-only server URL is `http://127.0.0.1:3015/native-probe/`, suitable for
the simulator on this Mac, not a phone. Generated `ios/`, `dist/` and
`node_modules/` are intentionally ignored.

## UI protocol

With an unlocked Mac and an isolated simulator, sign in to the synthetic
fixture, check the session, choose the generated `input-photo.png`, record
and play the synthetic tone, upload it, and open then cancel the share sheet.
Relaunch to check login persistence. Do not share to another person/service.
Record the observed results, including failures, in the A03 decision document.
This does not replace physical iPhone Safari/Android Chrome microphone,
permissions, interruptions and upload checks.

## Current evidence

The iOS simulator build succeeded with Xcode 26.6 and iOS 26.5 SDK. The local
simulator `WAKA Capture A03` (`FA6EE0CE-83F9-413A-A43C-CC24BF114C80`) verified
limited photo selection, image preview, opening/canceling the share sheet,
session retention after closing/reopening, and synthetic recording/playback.
The initial patched-fetch Blob upload failed; explicit native file encoding
fixed it. Saving/retrying returned 201/200 with one attachment and one source.
This does not establish physical microphone or Android native behavior. See
[`audio-capture-spike`](../../../docs/decisions/2026-10-02-audio-capture-spike.md).
