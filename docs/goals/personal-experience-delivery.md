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

### C06 correction and user flow completion

Added owned transcript read/correction/retry routes and the transcript panel beside the original audio player. The machine transcript remains stored separately from the owner's correction. Null explicitly returns to original wording; an empty correction explicitly keeps no words. Revision checks prevent a stale tab or pre-correction model response from overwriting newer intent. Effective material for extraction, embeddings, public-to-room input and quote checks uses the correction once, not as additional independent evidence.

Migrations 0051 and 0052 add correction/revision fields, extend material revision and redaction triggers, and persist an explicit-retry budget. Three retries are allowed per attachment per one-hour window beginning at the first explicit retry, in addition to worker/account budgets. Already-pending work is joined without another attempt. The UI shows when retry is available and bounds automatic GET checks at twenty; opening the panel never posts a retry.

Real browser checks on the isolated stack: correction save and reload, original transcript disclosure/restoration, two-tab revision conflict with preserved local edit and an explicit "Use my edit" decision, and failed-to-pending retry. Original audio played while transcription was pending (`readyState=4`, paused false, no decoder error). At 390×844 the editor had no horizontal overflow, 44px action buttons and 16px input text. See [mobile editor](../craft/evidence/personal-capture/transcript-editor-mobile.jpg) and [conflict](../craft/evidence/personal-capture/transcript-conflict.jpg). The fixture transcript is explicitly seeded synthetic text, not a claim about model accuracy.

The live queue pipeline used only synthetic English speech and silence. Pre-announced cap: two calls, estimated below USD 0.05. Both passed through the real queue, local S3 transport, production provider adapter and fenced persistence. Observed calls: 2; estimated cost USD 0.000403; job durations 1,722 ms and 1,341 ms. English produced a 99-character transcript; silence stored unavailable/no speech with no invented text. Source text remained empty, and each pass durably requested derivation. [Measured results](../craft/evidence/personal-capture/audio-pipeline-results.json) and `tools/e2e/audio-transcription-pipeline.ts` preserve the protocol; reruns require `--live` and an explicit loopback test database. No real account audio was sent.

Verification: web full suite 491/491 before the final added late-view regression; subsequent targeted checks 74/74 include that regression. Final API unit 711 passed, three paid-live benches skipped; goal index 3/3. Current isolated SQL suites: 20/20 transcript lifecycle/enrichment/export; account erasure 6/6. Typechecks, web build, vocabulary/seam/verb/type gates and migration consistency pass. Budget/queue rollback, stale copied quote withdrawal and effective embedding/public input are included in the SQL cases. Initial test-gate failures (undeclared API mocks, literal font size, unregistered verb inverses) were corrected without raising ceilings or removing checks.

C06 verdict: implementation and scoped verification complete; physical-device validation remains deferred by owner and remote deployment remains Q03. The original 25 MiB upload cap and 12 MiB inline-transcription cap remain distinct and are disclosed through the unavailable state; larger originals are preserved. Next capture work is C03/C04 input-specific polish, C05 safe re-recording, and C07/C08 reflection/detail integration. The rest of the 31-task objective remains active.

### C05 safe re-recording and interruption behavior

The composer now offers Record again without deleting the old clip. A completed replacement stays separately in the owned IndexedDB draft until the user chooses the new or previous recording. Both blobs survive reload; Save and the keyboard save shortcut remain blocked until that choice. Accepting a replacement does not reuse the old upload ticket. The player distinguishes Previous recording from New recording, pauses previews during recording, and labels draft clips as not yet saved.

Added explicit recording cancellation, missing/busy microphone messages, page-exit and track-ended notices, a five-minute limit notice, and a before-unload warning only while recording/finishing. Leaving the page during a pending permission request invalidates the late grant and releases its tracks. Empty or failed recorder output is not offered as a replacement. Existing clip bytes survive cancellation or failure. Browser/OS termination cannot be claimed to preserve an unfinished clip that has not reached durable storage; physical interruption cases remain deferred.

Real Chromium fixture checks: created a clip, canceled one re-recording, completed a replacement, reloaded and recovered both clips, kept the previous one, then completed/selected another replacement. Cmd+Enter before choosing created no source or upload and explained the required choice. After selection that notice cleared. Final counts: one seed became two inspirations, one attachment, one save request and one object. No unchosen clip was uploaded. [Replacement choice](../craft/evidence/personal-capture/recording-replacement.jpg) records the UI. Audio was synthetic and the analysis worker was disabled; no paid calls were made.

Verification: full web suite 502/502, typecheck and production build passed before the final labeling/notice/width polish; targeted recheck 53/53 across six suites also passed. The browser inspection caught the old inline-capture max-width constraining the new composer, which was removed only for the composer textarea. The final callback also refuses an empty/oversized/non-audio candidate while preserving an existing clip. C05 is complete under the owner's physical-device deferral. C03/C04 and C07/C08 remain the next capture work.

### C03 link preview and bounded recovery

Connected saved link metadata to the opened attachment detail: title, site, description, a passive thumbnail and collapsed page text, separate from the owner's note. The original HTTP(S) link stays usable before metadata arrives and after failure. Access-required pages receive a short explanation; unsafe schemes and credential-bearing URLs are not navigable from the saved preview. URL detection handles case and surrounding punctuation, and canonical deduplication prevents duplicate attachments without rewriting authored text.

Thumbnail reads require the owner's current access and use a no-store internal route. External URLs do not reach the renderer: the details response provides only availability and strips the remote thumbnail URL. Fetching is bounded to 2 MiB of PNG/JPEG/WebP/GIF, denies private addresses and credentials, checks every redirect and pins validated DNS answers into the connection. No cookies or authorization are forwarded. The existing rule preventing pictures on field orbs stays unchanged. The first full web run caught a direct preview-URL read (513 passed, one failed); moving thumbnail availability behind the owned detail contract corrected it without weakening that gate.

Attachment-specific retry and whole-source recovery now share the atomic three-retries-per-hour budget. Migration 0053 renames the existing counters without discarding them. Ready/pending work is not restarted, an exhausted stale lease can be recovered, and corrected transcript material does not masquerade as unfinished analysis. Tests include foreign-account refusal, read-only credentials, deletion, unavailable thumbnails, sibling isolation, expired budgets and the whole-source bypass regression.

Verification: API unit 715 passed, three paid benches skipped; targeted SQL 31/31 across preview, transcript and processing routes, followed by 7/7 preview-route recheck after the final response-shape change. Web full suite 514/514, both typechecks, production build and migration consistency passed. No paid provider calls or remote database writes were used. Actual local browser checks showed a loaded authenticated thumbnail, a separate readable note/excerpt, and an unavailable page retaining its original URL. Explicit retry left the ready sibling at zero retries and created exactly one pending enrichment job. A link-only capture containing two canonical-equivalent URLs added one inspiration, one attachment and one save request; reopening showed the original link while analysis waited. At 390×844 there was no horizontal overflow and link/summary/retry targets measured 44px. [Mobile evidence](../craft/evidence/personal-capture/link-preview-mobile.jpg) uses explicitly seeded metadata, not live extraction output.

C03 passes. C04 input-format/size/orientation and partial-upload polish plus C07/C08 remain open; the shared image-description panel alone does not complete C04. Physical-device checks remain deferred by owner, and deployment remains Q03. The temporary browser tab/server and exact disposable SQL schema were cleaned up after verification.
