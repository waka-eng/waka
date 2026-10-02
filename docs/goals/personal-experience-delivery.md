# Personal experience delivery

Status: in progress (2026-10-02), owner requested all personal-experience work bundles.
Branch: `codex/personal-capture-foundation`.

## Objective

Deliver every agreed task in [the personal experience task list](../plans/2026-10-02-personal-experience-tasks.md): A01–A03, C01–C08, R01–R08, S01–S04, V01–V05 and Q01–Q03. Preserve the existing capture foundation and its measurements in [the first-bundle record](personal-capture-foundation.md); do not rebuild already verified behavior. Group expansion and the older all-app backlog are outside this goal.

The owner explicitly deferred physical-device verification. Its cases remain follow-up work, with no claim of a real-device pass, and do not block these bundles. The owner confirmed that this goal includes only the existing 31 tasks: mobile app packaging and beta/store deployment preparation are excluded. Unresolved web deployment choices still require the appropriate owner input; do not infer broader external permissions from this objective.

## Gates

1. Capture completion — C03–C08 and Q01: every input can be saved, reopened and reflected upon; transcripts are derived from owned audio, corrections survive retries, and partial/failed work cannot erase or duplicate authored content. Test current-material and owner isolation under retries, deletion and account changes. Preserve the existing UI feel and usable keyboard/touch controls.
2. Review — R01–R08 and review portion of Q02: current reading/principles are legible; a bounded review keeps selections, answers and resume position. Selections are not belief votes. One answer spanning multiple sources is not counted as multiple independent experiences. Record comparison evidence before changing generation criteria.
3. Sharing — S01–S04 and sharing portion of Q02: selected wording renders correctly in both output sizes and supported languages, without hidden private material. Export edits do not mutate principles; cancel/retry does not publish, duplicate or lose the draft. Change cards use real historical wording only.
4. Avatar — V01–V05: owned conversations use current authorized memory with inspectable citations; no invented memories, cross-profile leakage or automatic adoption of AI text. Stop/retry, corrections, selective capture, deletion and export are tested. Evaluate the specified sparse/conflicting/changed/withdrawn-memory cases.
5. Delivery — Q03: targeted checks and failure-path evidence accompany each bundle. Inspect current remote/PR/deployment state before shipping. Record environment identity, migrations, recovery/rollback steps and actual dev verification; build success alone is not deployment evidence.

The task list supplies the detailed acceptance criteria for every gate. Partial modules, screenshots and green unit tests do not by themselves complete a feature. Keep the full objective open until all agreed gates are satisfied or a genuine external dependency prevents further in-scope progress.

## Verification and safety

Use targeted API/web tests and typechecks, schema consistency checks and browser journeys. SQL fixtures must explicitly use a disposable loopback database, never implicit `.env.local`. Preserve tenant-bearing foreign keys, human wording locks, current-input/worker-claim fences and private reflection boundaries. Do not send real account audio to a provider for testing. Announce call count and cost before paid evaluation; stop on twice the stated estimate.

## Log

### 2026 10 02 baseline and first next step

The previous bundle is committed through `80b23f1`, including desktop/iOS/Android emulator evidence. The owner's physical-device deferral is present in pending documentation changes and is preserved. The prior web run passed 484 tests with one worker; this is historical evidence, not a new run of future changes.

Current gaps confirmed in code: audio attachments are saved with enrichment unavailable; enrichment kind supports page bodies and image descriptions only. No durable transcription/correction pipeline exists. Begin C06 with bounded transcription input/output contracts and provider tests, then connect persistence, worker fencing and UI. Do not mark C06 complete until the end-to-end contract passes.

### C06 transcription input and provider foundation

Added a bounded single-attempt Gemini adapter using the previously evaluated Flash model. It verifies byte signatures against the declared MIME, parses audio metadata, bounds duration and inline bytes, uses the existing request deadlines, and rejects truncated/malformed outputs instead of storing a partial transcript as success. Silent output is distinct from unavailable/failed work. No live model calls were made.

The initial metadata-only approach rejected the real MediaRecorder WebM fixture: browser recordings omit Segment Duration. Added a bounded EBML timing reader for validated audio-only Opus, reporting a conservative upper bound from block timestamps and the 120 ms per-packet maximum, not a falsely exact measurement. Unit coverage includes unknown-sized clusters, timestamp scale, lacing bounds and malformed input. The synthetic browser recording is checked in as a non-personal regression fixture.

Initial targeted result: 19/19 tests passed, API typecheck passed. The metadata-only WebM attempt failed and was replaced with the block-timing path. The 12 MiB inline-transcription limit is separate from the existing 25 MiB original upload limit; larger originals remain playable with an honest transcription-unavailable outcome until a larger-file transport is implemented.

The whole API gate then refused two unreachable modules. Rather than parking them or weakening the gate, connected audio to the deployed enrichment worker, added migration 0050 for the enrichment kind, and made new audio captures request analysis. Uploaded objects are read under byte/time limits; arbitrary audio URLs are refused. Successful transcript persistence and downstream learning requests share the existing source/worker-fenced transaction; a replay reuses committed text without another provider request.

Current checks: API unit 711 passed, three paid-live benches skipped; real isolated-Postgres suites 25 passed (five audio lifecycle, five bundle, fifteen source/job durability); API/web typechecks passed; goal index 3/3; migration consistency passed. SQL cases cover unchanged raw notes, cached replay, attachment replacement, parent deletion and lost worker claim. No remote database/migration or paid calls were used.

C06 is still open: user correction and retry endpoints/UI, duration/status presentation, effective-material projection for corrections, and correction-specific erasure/export/race tests remain. Next work connects those pieces before claiming the audio feature complete. None of the other 31 tasks is silently treated as satisfied by this backend slice.

Technical references: [Gemini audio input](https://ai.google.dev/gemini-api/docs/audio), [music metadata](https://github.com/Borewit/music-metadata), [Matroska elements](https://www.matroska.org/technical/elements.html), [Opus framing](https://www.rfc-editor.org/rfc/rfc6716).
