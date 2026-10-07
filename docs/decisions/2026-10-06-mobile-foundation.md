# Mobile foundation integration decisions

Status: M1 implementation and native verification in progress (2026-10-06).

## Shared source and platform boundary

`packages/web` owns all consumer screens/routes/styles. `packages/mobile` owns
packaging and the two native projects. `src/lib/platform` exposes identity,
protected credentials, private files, the public API handshake, browser opening
and native URL events. Native session/capture/sharing integration stays in its
own M2/M3/M4 milestone. The consumer feature inventory records each parity case.

## Dependencies and licenses

| Dependency | Pin | License and ownership | M1 compatibility evidence |
| --- | --- | --- | --- |
| Capacitor core CLI iOS Android | 8.5.2 | Official Ionic/Capacitor packages; MIT | Native project generation; Android dev build and iOS dev simulator build passed. |
| App | 8.1.2 | Official; MIT | Both platforms compiled; real OS URL delivery, restart and callback replay checks pass on both simulators. |
| Browser | 8.0.5 | Official; MIT | Both native platforms compiled. Actual provider authentication and sign-in session behavior remain M2. |
| Filesystem | 8.1.4 | Official; MIT | Both platforms pass private fixture write and read after full app termination/relaunch. |
| Protected credentials | Owned Swift/Java bridge | WAKA source; uses OS security APIs | Native write, relaunch/read and cleanup pass on both simulators; Android ciphertext excludes plaintext. |
| Existing font families | Fontsource 5.3.0; Pretendard 1.3.9 | SIL Open Font License 1.1 | Mobile builds include local font assets and license texts. Actual Pretendard/Jost loaded-family checks pass on both simulators. |

Package versions were checked against the registry's stable major-8 versions.
Only the selected official native plugins are installed. Native camera,
recording and share-extension dependencies will be selected in their owning
milestone rather than declared compatible by this foundation build.

## Credentials and local files

Use iOS generic-password Keychain items with a bundle-specific service and
`AfterFirstUnlockThisDeviceOnly` accessibility. Android uses AES/GCM with a
Keystore-generated key, random IVs, authenticated key names and private
ciphertext. Writes acknowledge persistence before returning; failures never
fall back to plaintext. Android backup is disabled for this initial native
shell so ciphertext cannot be restored without its device key.

Use Filesystem Data for small app-private files in the M1 proof. M3 must add
account/profile ownership, revision checks, file retention, backup exclusions
where required, and a transactional draft catalog. The private readiness file
contains only app identity and public service availability, never account data.

Bridge request/response logging is disabled in both targets so future credential
or file calls do not become persistent logs. Dev WebViews remain inspectable;
production WebViews explicitly disable inspection on both platforms.

## Authentication and transport

The app-side prototype generates random state and a real S256 PKCE challenge,
checks the exact callback destination and expiry, rejects duplicate/unknown
parameters, and carries only a short-lived code. Nine real-WebCrypto/URL tests
pass. A native encrypted pending attempt is designed to survive app suspension;
successful consumption removes it before a replay can join that attempt.
Consumption/removal and replay rejection pass on Android and iOS. These checks
do not establish server-side
single-use exchange, provider sign-in or human-profile binding. M2 must implement
those independently and must not reuse an agent-bound CLI session.

Prefer an ordinary shared JSON client with a native Bearer credential and
restricted origin policy for M2, preserving cancellation/error behavior.
The M1 public health handshake uses explicit native HTTP and reaches dev from
the installed iOS app. Globally patched fetch remains disabled: the earlier
probe demonstrated a Blob upload failure. M3 must validate native file transport
against the existing signed PUT contract and keep WAKA credentials off S3 URLs.

## Initial environment constraints (2026-10-06)

Android dev APK built successfully in 35 seconds with SDK 36/JDK 21. The new
AVD could not allocate a userdata partition: 2360.55 MB available versus 7372.80
MB required. An existing test AVD booted in 18.26 seconds and accepted the APK,
but concurrent simulator/compiler pressure exhausted host space. Test devices
were stopped; existing userdata was preserved. The empty iOS test simulator
created for M1 was removed; the existing WAKA A03 simulator was used instead.

iOS dev App.app built, installed and launched, preserving WAKA's existing login
screen. Its native identity was `im.waka.app.dev`, and its private readiness
record confirms `connected: true` at `https://dev.waka.im`. An external callback
displayed an Open confirmation that was not yet accepted. Host UI automation
reported the Mac locked. A public XCTest driver was added to exercise the actual
OS handoff and storage through the installed app.

Xcode 27's test runner rejected the current CoreSimulator/CoreDevice components:
CoreSimulator 1051.55.0 is older than required 1171.7.0. Administrator-assisted
Xcode component setup is needed. A production iOS build also failed with
`No space left on device`; it is not accepted. The production web bundle did
pass its diagnostic exclusion check after a direct compile-time import gate
replaced the initial cross-module condition. Native coexistence and remaining
M1 gates stay open until verified with adequate host resources and SDK setup.

## Resumed iOS acceptance (2026-10-07)

The owner's first-launch setup repaired the SDK: CoreSimulator is now 1171.7
and `xcodebuild -checkFirstLaunchStatus` exits successfully. The real XCTest
driver passes Keychain/private-file write, full app termination and persisted
read, native callback consumption/removal, replay rejection, cleanup, actual
font loading, correct dev API handshake and the login route. No account login
or database mutation is involved.

This exposed a build defect: disabling code signing entirely leaves no
simulated app identity, so Keychain refuses writes. The simulator-only build
now asks Xcode to ad-hoc sign and embed app-scoped simulated entitlements.
Manually adding restricted iOS entitlements to the macOS code signature was
rejected by AMFI and is not used. Real-device/store signing remains M6 and
must use a provisioned Apple team identity. Apple's
[Keychain access-group documentation](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)
explains the app-identity isolation requirement.

Regenerated Capacitor packages target iOS 17; the tracked native project and
README now match that minimum rather than relying on the earlier manually
lowered generated manifest. Mobile HTML includes `viewport-fit=cover` so
safe-area offsets keep the connection banner below the status bar.

Android already has a real airplane-mode/network-denial check. iOS uses a
dev-only controlled connection-failure UI fixture followed by the real native
HTTPS Retry handshake; this is not proof of actual iOS radio/network denial.
Physical-device networking, provider authentication and signed uploads remain
explicit later-milestone acceptance cases.
