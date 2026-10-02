# Audio capture spike

Status: partial A03 evidence. Actual iPhone Safari and Android Chrome testing is unavailable, confirmed by the owner on 2026-10-02. A03 remains incomplete.

## Current decision

Use `gemini-2.5-flash` as the candidate for the later C06 transcription integration. It passed all six predeclared synthetic fixtures. Do not use `gemini-2.5-flash-lite` as an automatic fallback: it added unrequested timestamps to the Korean transcript and failed the output contract in this run. No transcription provider is wired into production by this spike.

Continue building the shared web capture flow. Capacitor rollout timing remains provisional until its bounded native probe and physical-device checks are complete. A mobile-sized desktop window is not iPhone or Android evidence.

## Browser recording and saving

The production web bundle ran against real authenticated Hono routes and an isolated local Postgres schema. An in-memory S3 transport handled actual browser PUT and server HEAD. A fixture replaced microphone acquisition with a generated WebAudio tone; the browser's MediaRecorder, File, Blob, audio player and IndexedDB were real.

- A recording produced a playable WebM file. Playback showed `paused=false`, `readyState=4`, with no decoder error.
- Reload before saving restored the recording and its audio controls from IndexedDB.
- The recording saved with no authored text. Deliberately losing the successful save response still opened reflection and left one source, one audio attachment and one save identity for that intent.
- Photo-only capture also recovered its bytes after reload. A forced PUT failure kept the draft; retry saved it without reselecting the image.
- Across these fixture actions: one seeded inspiration became four inspirations, three attachments and three save-request records. Object storage held one photo and one recording. The link was part of its original inspiration transaction.

These results do not establish AWS policy/signature correctness, actual microphone quality, background recording, phone permissions or native login retention.

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

## Remaining A03 checks

The bounded Capacitor probe is checked in under
[`tools/e2e/native-capture-spike`](../../tools/e2e/native-capture-spike/README.md).
Its iOS simulator build succeeded (Xcode 26.6, iOS 26.5 SDK, signing disabled).
The Mac was locked when native UI access was attempted. The isolated simulator
was created but not booted or launched, so recording, photo selection, share
sheet and session retention are **not** verified. An unlock request is pending;
this restriction was not bypassed. No production mobile configuration changed.

| Requirement | Evidence still needed |
| --- | --- |
| Actual iPhone Safari | Microphone allow/deny, recording, playback, upload, lock screen and app interruption |
| Actual Android Chrome | The same real-device cases |
| Native container | Bounded Capacitor recording, photo choice, file sharing and login persistence probe |
| Supported formats and limits | Device results to finalize formats, five-minute limit and interruption recovery claims |

The current recorder tries a supported WebM/Opus, MP4, WebM or Ogg/Opus format at runtime. The proposed maximum remains five minutes and the server upload cap is 25 MiB. It stops on page visibility loss; physical-device behavior and interrupted-file recoverability remain unverified. Raw audio storage already works in the fixture, while durable server transcription/correction is C06 work.
