# Audio capture spike

Status: A03 complete on 2026-10-04 within the owner's subsequently approved simulator-based scope. Actual iPhone Safari and Android Chrome hardware checks remain unverified follow-up work, not a support guarantee.

## Current decision

Use `gemini-2.5-flash` for transcription. It passed all six predeclared synthetic fixtures and was subsequently integrated in C06 and delivered to dev. Do not use `gemini-2.5-flash-lite` as an automatic fallback: it added unrequested timestamps to the Korean transcript and failed the output contract in this run. The speech measurement is synthetic-fixture evidence, not a real-device recording evaluation.

Continue web-first for the agreed 31 tasks. Capacitor packaging and beta/store deployment are outside that scope and require a later rollout decision. The owner first deferred physical testing, then explicitly accepted simulators for the remaining milestones. A03 is complete under that substitution; its physical checks remain unverified. A mobile-sized desktop window or simulator does not establish physical-device behavior.

## Browser recording and saving

The production web bundle ran against real authenticated Hono routes and an isolated local Postgres schema. An in-memory S3 transport handled actual browser PUT and server HEAD. A fixture replaced microphone acquisition with a generated WebAudio tone; the browser's MediaRecorder, File, Blob, audio player and IndexedDB were real.

- A recording produced a playable WebM file. Playback showed `paused=false`, `readyState=4`, with no decoder error.
- Reload before saving restored the recording and its audio controls from IndexedDB.
- The recording saved with no authored text. Deliberately losing the successful save response still opened reflection and left one source, one audio attachment and one save identity for that intent.
- Photo-only capture also recovered its bytes after reload. A forced PUT failure kept the draft; retry saved it without reselecting the image.
- Across these fixture actions: one seeded inspiration became four inspirations, three attachments and three save-request records. Object storage held one photo and one recording. The link was part of its original inspiration transaction.

These results do not establish AWS policy/signature correctness, actual microphone quality, background recording, phone permissions or native login retention.

Android Chrome on the API 35 emulator subsequently passed text plus synthetic
audio capture, draft reload/playback, failed-upload recovery, lost-save-response
reconciliation into reflection, and photo-plus-link saving. The two save intents
created two sources and three attachments, confirmed by isolated SQL. This is
Android Chrome emulator evidence, not physical microphone evidence or an
Android Capacitor build. After the final save committed, the emulator terminated
with exit 137; its cause was not established, so post-termination reopening was
not verified. The goal log records exact counts and screenshot paths.

## Speech evaluation

Protocol fixed before calls: six fixtures × two models, twelve calls, no automatic retries. Per speech fixture, normalized character error must be at most 5%; silence and tone must yield empty transcripts. Normalization removes punctuation, spacing and case, and treats the spoken Korean numbers three/five and their digits equivalently. Other additions and omissions remain errors.

Fixtures: English, Korean, mixed Korean/English, Korean time/duration wording, three seconds of silence, and the browser-generated WebM tone. Speech uses local macOS Samantha/Yuna synthesis, not personal account audio. Each model saw only audio plus a fixed transcription instruction; reference text was not in the prompt.

| Model | Fixtures passed | Observed request duration | Estimated list-price cost |
| --- | --- | --- | --- |
| Gemini 2.5 Flash | 6 of 6 | 1.328–1.985 seconds | USD 0.002191 |
| Gemini 2.5 Flash Lite | 5 of 6 | 0.701–1.434 seconds | USD 0.0006376 |

The failed Lite Korean result included `00:00`, `00:03` and `00:05` inside the transcript. Its normalized character error was 30.23%, predominantly those unwanted timestamps; this should not be described as losing 30% of the spoken words. Flash's largest normalized error was 1.27% on English; its other five cases were zero.

Total estimated cost was USD 0.0028286 using returned usage and published standard token rates. This is an estimate, not a billing statement. The pre-announced limit was USD 0.10. Latency is for these short fixtures and this one run; it does not predict a five-minute recording or a noisy device sample. [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [audio input documentation](https://ai.google.dev/gemini-api/docs/audio).

The machine-readable [results](../craft/evidence/personal-capture/audio-transcription-results.json) include fixture references, returned text, normalized scores, timing, usage and hashes. Run `pnpm tsx tools/e2e/audio-transcription-eval.ts` to prepare synthetic WAV fixtures without a paid call; add `--live` explicitly for the bounded comparison. The optional `--tone` argument supplies a browser-produced WebM negative fixture.

## Simulator acceptance and remaining hardware checks

On 2026-10-04, after explicit approval of Chrome's Terms for the test emulator,
a stable Android API 35 session verified recording interruption after leaving
the page. The returned page displayed the interruption notice and the synthetic
clip played to 0:22 before saving. One save produced one private audio source,
one attachment, one save receipt and one stored object; reopening showed the
original player. The transcription worker was deliberately disabled. This
does not establish post-save playback advancement or completed transcription.

The same session verified keyboard-safe chat entry and draft retention across
an app switch. A scrollbar covering right-edge text was fixed with an 8px
content gutter and checked again. A prior session had garbled typing and exit
137; warnings showed memory pressure, but its cause was not established. Both
failed and successful evidence are retained. A fresh iOS Safari check rendered
the chat route; prior unchanged-path iOS evidence below is reused.

Evidence under `docs/craft/evidence/personal-capture/`:
`android-m8-recording-interruption.png`, `android-m8-recording-reopened.png`,
`android-m8-chat-keyboard.png`, `android-m8-app-return.png`,
`android-m8-chat-gutter.png`, `android-m8-input-failed.png` and
`ios-m8-conversation-route.png`. All contain synthetic local fixtures.

The bounded Capacitor probe was checked in under
`tools/e2e/native-capture-spike` (removed 2026-10-17; see version history).
Its iOS simulator build succeeded (Xcode 26.6, iOS 26.5 SDK, signing disabled).
After Mac UI access became available, the iOS simulator verified limited photo
selection/preview, opening/canceling the file share sheet, session retention
after full app closure, and synthetic WebM/Opus recording/playback/upload.
Patched fetch rejected the audio Blob with `CapacitorUrlRequestError error 0`;
the probe now explicitly encodes native file requests as base64 with
`dataType: file`. Saving then retrying returned 201 then 200 and produced only
one inspiration/attachment/request/object. No production mobile configuration
changed, no host microphone was recorded, and no file was shared externally.

| Requirement | Evidence still needed |
| --- | --- |
| Actual iPhone Safari | Microphone allow/deny, recording, playback, upload, lock screen and app interruption |
| Actual Android Chrome | The same real-device cases |
| Native container | iOS synthetic recording/photo/share/session probe passes; actual microphone and Android native behavior remain unverified |
| Supported formats and limits | Device results to finalize formats, five-minute limit and interruption recovery claims |

The current recorder tries supported WebM/Opus, MP4, WebM or Ogg/Opus at runtime. C05 enforces five minutes and the server upload cap is 25 MiB; C06's inline transcription cap is separately 12 MiB, with larger originals preserved. It stops on page visibility loss; physical-device behavior and interrupted-file recoverability remain unverified. Durable transcription/correction and their scoped queue/browser checks are recorded in [the delivery log](../goals/personal-experience-delivery.md). Android native behavior and actual-device cases remain unverified; the current decision does not advertise native mobile support.
