# iOS capture: handoff for the native build

Status: design approved (founder, 2026-11-08). Web side is being built on the
`build/*` branches; everything in this file needs Swift, Xcode and an Apple
Developer account, which this repo's machines do not have. Nothing here has
been compiled.

The design is the "G" row of the onboarding canvas
(https://claude.ai/artifact/LQzmPRYHzRkggfDX6cZP5C, frames G1–G6). The goal
it serves, in the founder's words: "the most frictionless way to save my
inspirations that happen anywhere — in person convos, online, etc." Inside the
app a save is already two or three taps; the friction is getting into WAKA.
Every piece below is a way in that skips opening the app.

## Where the app stands

- `packages/mobile` is a Capacitor 8 shell: `im.waka.app` (prod, waka.im) and
  `im.waka.app.dev` (dev, dev.waka.im), iOS 17+. M1 foundation and M2 accounts
  passed on the simulator (`docs/goals/capacitor-foundation.md`,
  `docs/goals/native-accounts.md`).
- M3 native capture (camera, recorder, durable drafts) was paused on
  2026-10-07 (`docs/goals/native-capture.md`); its branch is not on GitHub.
- The session credential lives in the Keychain under service
  `<bundle id>.credentials`, accessible after first unlock, this device only
  (`ios/App/App/SecureStoragePlugin.swift`; web side
  `packages/web/src/lib/platform/session.ts`). The API accepts it as a
  `Bearer` header (`packages/api/src/lib/middleware.ts`).
- Info.plist already has camera and microphone usage strings.

## Build order

1. **G4 Share Extension** — covers screenshots, links and things friends send,
   which is most of what gets saved.
2. **G2/G3 voice that keeps itself + G1 doors** (one App Intent behind the
   Lock Screen widget, Control Center control, Action Button and Siri).
3. **G5 camera + newest photos.**
4. **G6 paste-ready home.**
5. TestFlight to the founder's phone, then App Store.

## G4 · Share Extension ("Kept in WAKA")

Frame: the system share sheet → WAKA → a small sheet: thumbnail, "Kept in
WAKA", "Screenshot · I'll read the words in it", Done, and an optional note
field with a mic.

- New target: Share Extension, `im.waka.app.share` (and `.dev`). Activation
  rule: images (up to 4), URLs, plain text.
- **It saves the moment the user picks WAKA.** No Save press. The system share
  sheet is a deliberate act by the user, so this is safe natively. (The web
  `/share` route is different: any website can open it, so it waits for Save.
  Do not copy that behaviour here.)
- The note is optional and is added to the same inspiration afterwards; Done
  closes the sheet. Closing without a note is the common case.
- Credential: move the session into a **shared Keychain access group**
  (`$(AppIdentifierPrefix)im.waka.app.shared`) used by both targets, and add an
  **App Group** (`group.im.waka.app`) for the handoff queue below.
- Upload path (same as the app's composer):
  1. `POST /api/attachments/presign` → presigned S3 PUT; PUT the bytes with
     the exact content type.
  2. `POST /api/inspirations` with an `Idempotency-Key` header (one UUID per
     share, reused on retry) and the attachment / link / text.
  3. `POST /api/attachments` finalizes uploads; see
     `packages/api/src/routes/attachments.ts` and
     `packages/web/src/lib/use-authored-save.ts` for the exact order the web
     client uses.
- Extensions are killed quickly and have ~120 MB. If the upload cannot finish,
  write the payload to the App Group container and let the main app finish it
  on next launch (same Idempotency-Key, so it never saves twice). Show "Kept"
  either way; the save is durable once it's in the container.
- Signed out: say "Open WAKA to sign in first" and keep the payload in the App
  Group until sign-in.
- HEIC is accepted by the API's image reader; strip location metadata from the
  upload copy (M3 gate 2).

## G1–G3 · Voice from anywhere ("Say it"), and the doors to it

Frames: G1 Lock Screen with "Say it" and "Snap it"; G2 listening (creature,
live words, a large "Done" — **tap to start, tap Done to stop, never hold**);
G3 "Kept" with Undo for a few seconds, then back to where you were.

- One **App Intent**, "Save to WAKA" (with a parameter: voice | camera),
  `openAppWhenRun = true`, routing into the app by deep link:
  - `im.waka.app://capture/voice` → the web layer opens G2 and starts recording.
  - `im.waka.app://capture/camera` → camera (G5).
  The web branch `build/home` owns these routes; coordinate the exact path
  names with it before shipping.
- Expose it through **App Shortcuts** (`AppShortcutsProvider`) with phrases
  like "Save to WAKA" / "WAKA에 저장" — this also makes it assignable to the
  **Action Button** and Back Tap with no extra work.
- **Lock Screen widget**: WidgetKit accessory-circular, two widgets (Say it,
  Snap it), each `widgetURL` → the deep links above.
- **Control Center control** (iOS 18+ `ControlWidget`) running the same intent;
  guard with availability checks since the app supports iOS 17.
- Recording keeps itself on Done; Undo deletes that inspiration. Same
  five-minute limit and transcription as the composer today. Recording must not
  continue in the background (no background-audio mode).

## G5 · Photo: camera, then newest

Frame: "Take a photo" on top, then the newest photos, newest first.

- Camera: `UIImagePickerController(sourceType: .camera)` or the Capacitor
  Camera plugin.
- Newest photos without library permission: the iOS 17 **embedded
  PhotosPicker** (SwiftUI `.photosPickerStyle(.inline)`) shows the library
  out of process, so WAKA never needs full photo access. Do **not** request
  full library access — the founder's plan explicitly avoids it.

## G6 · "You copied this" → Keep it

Frame: on open, if the clipboard has a link or text, the bubble offers it with
Keep it / Not this.

- Detect without prompting: `UIPasteboard.general.detectPatterns(for:
  [.probableWebURL, .probableWebSearch])` / `hasURLs` / `hasStrings` (no
  "Allow paste?" prompt).
- Read only on the user's tap: **`UIPasteControl`** (Apple's paste button)
  reads without the prompt. It is a native view, so it needs to sit over the
  web bubble's "Keep it" position — the web layer can report that rectangle
  through a small Capacitor plugin. If that is too fiddly, a plain native read
  on tap shows the system prompt once; acceptable for a first version.
- Never read the clipboard silently on launch.

## App Store review risks to check early

- **Guideline 4.8 (login services):** the app offers Google sign-in. Apple
  requires an equivalent privacy-focused option (Sign in with Apple qualifies)
  when a third-party login is offered. Decide before submitting.
- **Account deletion in-app** is required (5.1.1(v)); the web has export and
  deletion (parity item A06) — confirm it's reachable in the app.
- **AI disclosure:** saves are sent to third-party models (OpenRouter /
  Gemini) for reading screenshots, transcription and readings. Apple's 5.1.2
  now wants this named and consented to before sending (mobile plan M6.6).
- Privacy nutrition labels: photos, audio, user content; no tracking.
- Usage strings: camera and microphone exist; add speech recognition only if
  you use on-device live transcription for G2's live words.

## Open questions for the founder

- Should Undo (G3) also exist for shares (G4)? Current design: no — the sheet
  stays until Done, so there's time to remove it from the app.
- G2 live words: on-device `SFSpeechRecognizer` while recording (needs the
  speech usage string), or show words only after the server transcript lands?
