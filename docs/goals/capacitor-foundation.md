# Capacitor app foundation

Status: done 2026-10-07 — M1 foundation accepted with simulator-based checks.
Native accounts, consumer parity and store distribution remain M2 through M6.
Branch: `codex/capacitor-m1`, based on dev `315328e`.

## Objective and scope

Implement M1.1 through M1.6 in the owner's accepted
[mobile plan](../plans/2026-10-06-capacitor-mobile-plan.md). Reuse the current
React application inside packaged iOS and Android Capacitor apps. Complete
both platform builds and simulator launches, with a consumer-feature parity
inventory and verified integration decisions before proceeding to M2.

## Gates

1. Inventory every currently available consumer feature. Record its web,
   iOS and Android acceptance case and the milestone owning remaining work.
2. Add the mobile workspace and tracked native projects with compatible stable
   Capacitor 8 dependencies and recorded maintenance/license decisions.
3. Dev and production builds use distinct app identities and the intended
   HTTPS API hosts; the two identities can coexist on each platform.
4. A reproducible build packages the shared React source. Sensitive environment
   values cannot enter the bundle; release builds disable WebView debugging,
   remote-page loading and diagnostic screens. Add small platform interfaces.
5. Verify secure-storage, local-file persistence and OAuth handoff approaches
   using synthetic native checks and targeted protocol tests. Record the exact
   behavior demonstrated and remaining M2/M3 integration work.
6. Build and launch bundled applications on both simulators. Verify routes,
   fonts/assets, native API health contact and an understandable offline state.
   SDK availability or a compiled binary alone cannot satisfy this gate.

## Verification and delivery

Run targeted build/config/protocol checks, web types/tests/build and native
builds. Use new dev app identities and synthetic fixtures only. No model calls
or database writes are required. Carry forward simulator-based acceptance;
physical camera/microphone testing remains the documented follow-up.

M1 ends at the installed-shell demonstration. Full native authentication,
capture, sharing and consumer parity acceptance remain M2 through M5. No
store registration, publishing, deployment or M2 work is implied.

## Log

### 2026 10 06 start

The existing checkout matches dev `315328e`, with only the mobile plan from
the preceding turn untracked. iOS 26.5 runtime inventory works via the installed
CoreSimulator executable. Android command-line SDK files and JDK 21 are present;
the default Java launcher is not configured. Native project/build work is next.

### 2026 10 06 implementation and native checks

The inventory covers 37 consumer feature groups and acceptance cases. Mobile
workspace/native sources, stable Capacitor 8 pins, separate public targets,
platform contracts and bundled fonts are implemented. Targets use iOS 16 and
Android API 24+, matching the generated Swift package/native dependencies.

Web types and 813 regressions pass; nine real-WebCrypto/URL protocol cases and
three mobile configuration cases pass. Six synthetic sensitive environment
markers, including an unapproved VITE-prefixed value, are absent from production
assets. The diagnostic module is excluded. Project syntax and local links pass.

Android dev/release builds passed. Emulator-5554 passes protected credential/file
write, app termination/reopen/read, pending callback consumption, replay rejection
and cleanup. Ciphertext excludes the synthetic plaintext; actual font families
report loaded. Receipt: `work/mobile-foundation/android-checks.json`, with APK hash.
Both identities coexist and reach the expected dev/production API hosts.
Production was signed with an isolated temporary test key for emulator installation;
its flags omit DEBUGGABLE. Airplane mode/Wi-Fi denial confirmed the bundled offline
screen. Network settings/ADB privilege were restored and the emulator stopped.

Native checks caught custom-scheme authority parsing differences and font imports
that bypassed Vite module transforms. Strict owned-scheme parsing and a PostCSS
font-family pass correct these; existing assertions now pass.

iOS dev/release binaries build, install and launch through CoreSimulator CLI.
Both IDs coexist; private readiness files confirm their correct API hosts.
iOS integration acceptance remains pending: external links show an Open
confirmation, host UI automation reports the Mac locked, and Xcode's UI runner
rejects CoreSimulator 1051.55 versus required 1171.7. Administrator-assisted
Xcode setup was requested. A prior disk-full build left a corrupt module cache;
that generated cache was moved aside and the release build subsequently passed.
No server, model, schema, paid-call or deployment work was performed.

## Current completion audit

| Requirement | Evidence | Result |
| --- | --- | --- |
| M1.1 feature inventory | 37 groups, source map and cross-platform cases | Passed |
| M1.2 projects and compatible dependencies | Native sources, lockfile, licenses and fresh-checkout builds on both platforms; repaired SDK/UI runner | Passed |
| M1.3 distinct targets | Both IDs installed on both platforms; native API-readiness files | Passed for observed binaries |
| M1.4 shared pipeline and release constraints | Final dev/release builds, target guards, sensitive-marker/diagnostic exclusion checks | Passed |
| M1.5 integration proofs | Android native receipt, nine protocol cases, iOS Keychain/file restart and callback/replay/cleanup XCTest | Passed for app-side prototypes; server/provider exchange remains M2 |
| M1.6 launch routes fonts and offline | Both native launch/routes/fonts/API checks; Android actual network denial; iOS controlled failure UI and real native Retry | Passed for foundation UI; actual iOS network-denial/device cases remain follow-up |

All M1 foundation gates are accepted with the scope and limits recorded above.
This is not full consumer-feature parity or a completed native sign-in flow.

### 2026 10 06 fresh checkout verification

The preceding goal turn was progress: implementation and Android acceptance
changed authoritative state. On continuation, Xcode first-launch status still
fails, CoreSimulator remains 1051.55, and administrator access still requires
a password. The iOS interaction blocker remains unchanged; no live setup job
was found.

A separate clean checkout of `6630813` initially had no generated native assets,
plugin configuration or Swift package manifest. `pnpm install --offline
--frozen-lockfile` passed in two seconds using the dependency store. Web types
and three mobile configuration cases passed. Both documented native dev build
commands regenerated their inputs and passed: Android in 13 seconds (185 tasks
executed), iOS with successful exit and its App.app receipt. The checkout stayed
Git-clean after builds. Logs are `work/mobile-foundation/clean-install.log`,
`clean-android-build.log` and `clean-ios-build.log`; the temporary checkout is
under `work/mobile-foundation/clean-aamMAT/checkout`.

Build reproducibility is now established independently of the working checkout's
caches/generated files. Remaining iOS storage/callback and offline interaction
acceptance still requires the requested Xcode component setup and native UI access.

### 2026 10 06 blocked audit

The previous goal turn was progress: fresh-checkout builds passed on both
platforms and were recorded in `5ef12de`. This third consecutive goal turn
revalidated the same iOS interaction blocker. `xcodebuild
-checkFirstLaunchStatus` exits 69, installed CoreSimulator is 1051.55, and
`sudo -n true` reports that a password is required. Process inspection found
no live component-setup or UI-test job. Native UI inventory again reports the
Mac locked, so the manual simulator interaction alternative is unavailable.

All independent implementation, Android native checks and fresh build
reproduction work is recorded. The outstanding iOS storage/callback and
offline/route checks require an external change: unlock the Mac and complete
Xcode component installation, for example `sudo xcodebuild -runFirstLaunch`
entered by the owner. Resume M1 after setup; retain the same acceptance gates.

### 2026 10 07 completion

Owner-installed components resolve first-launch setup and CoreSimulator version
mismatch (1171.7). Two real XCTest cases pass on iPhone 17 Pro/iOS 26.5:
Keychain and private-file persistence across full termination/relaunch; owned
OS callback delivery, consumption/removal and replay rejection; fixture cleanup;
actual loaded Pretendard/Jost fonts; dev API health; login navigation; a controlled
connection-failure banner and retry using the real native HTTPS handshake.
Receipt: `work/mobile-foundation/ios-checks.json`; screenshots are in
`work/mobile-foundation/ios-final-attachments/`. The iOS failure case simulates
the UI state without changing the Mac's network; actual iOS radio/network denial
is not claimed. Android's prior real airplane-mode check remains recorded.

Native acceptance caught and fixed missing simulated Keychain entitlements.
Xcode now embeds these and ad-hoc signs simulator artifacts without a developer
certificate; direct restricted-entitlement codesigning was rejected and removed.
Generated package minimums require iOS 17, now matched by the tracked project.
Mobile-only viewport safe-area support fixes status-bar overlap. Failed attempts
are preserved in native logs rather than counted as acceptance.

Final iOS/Android dev and production builds pass. Both iOS app identities still
coexist; the rebuilt production app launches and its readiness file confirms
`https://waka.im`. Android identity/coexistence evidence from the earlier native
run is retained. The separate checkout fast-forwarded to `d79beed` and reproduced
the corrected iOS/Android dev builds; earlier fully fresh native generation is
recorded above. Final web types, 813 web tests, nine protocol cases and three
mobile policy cases pass. No database/model changes, paid calls, remote push,
deployment or M2 implementation occurred. Stop at the M1 checkpoint.
