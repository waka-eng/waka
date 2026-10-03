# Capture failure audit

Recorded 2026-10-02 for Q01. The shipped web build used real authenticated Hono routes, disposable loopback Postgres, browser IndexedDB/MediaRecorder and an in-memory S3 transport. Microphone input was a synthetic tone; background model jobs were disabled. No remote account data or paid calls were used. Physical-device verification remains explicitly deferred by the owner.

## Save and reopen matrix

All five cases saved, answered one reflection, finished without requesting another question, and reopened the saved answer through the app. Photo and audio originals were kept without invented authored text.

| Input | New inspirations | Attachments | Saved answers | Observed behavior |
| --- | ---: | ---: | ---: | --- |
| Link only | 1 | 1 | 1 | Unadded URL survived close/reload, then Add and Save and think further worked |
| Text only | 1 | 0 | 1 | Exact authored note and answer reopened |
| Photo only | 1 | 1 | 1 | Original image kept with empty authored text |
| Recording only | 1 | 1 | 1 | Original player readyState 4/no decoder error while transcription was pending |
| Text, photo, link and recording | 1 | 3 | 1 | Successful create response was dropped; same saved bundle recovered, then reload retained the unfinished answer |

Final first-fixture counts: six inspirations including one seed, six attachments, five reflections, ten save-request receipts and four objects across four PUTs. Reopening all five reflections did not increase those save counts. The mixed photo loaded and its audio decoded after reload. The response-loss flag was consumed after the actual commit; only one mixed inspiration existed.

## Failure and boundary evidence

| Condition | Evidence and boundary |
| --- | --- |
| Separate link field closed before Add | Defect found and fixed: the URL is now in the owned draft; Save and Ctrl/Cmd+Enter refuse to omit it. Add/cancel is explicit. |
| Account change | A second real fixture account showed an empty composer. Returning to the first restored its note and unfinished URL; no POST occurred during switching. |
| Connection lost before create | The fixture dropped one request before the application handler. Recovery ultimately produced exactly one source, one attachment and one receipt, with confirmed saved status. This was a one-shot connection loss, not a persistent OS offline test. |
| Successful response lost | Current mixed-input journey above and the earlier Android emulator journey reconciled one committed intent without duplicates. |
| Some uploads fail | C04 browser evidence: second file failed, first receipt and all original files survived reload; individual retry did not resend the first or upload the third. |
| Permission denial, cancellation and interruptions | Current recorder suite exercises denial, device absence/busy, cancellation, hidden-page stop, lost track, late grants and unmount. Earlier iOS simulator Safari denied the actual permission path without losing text. Physical phone/lock-screen cases remain deferred. |
| Transcription failure and correction | C06 browser evidence covers playing originals while pending, explicit retry, revision conflict and restoration. Current SQL recheck covers correction precedence, queue rollback, stale worker rejection and deletion. |
| Save retry or late response | Current authored-save tests cover immutable request identity, lost response, bounded timeout, changed owner, cleanup failure, unsupported recovery protocol and late earlier-attempt responses. |
| Device draft storage | Current store/hook tests cover owned bytes, stale-tab conflicts, superseded saves, replacement recordings and unfinished links. A storage failure is not represented as durable success. |

The second fixture ended with two inspirations including its seed, one link attachment and one save receipt. This count belongs to a separate schema and is not added to the five-case matrix. Both exact disposable schemas and browser/server sessions were cleaned up.

## Checks and limitations

Web full suite: 545 passed before the final keyboard regression was added. Subsequent capture/navigation plus goal-index recheck: 13 passed, including that new regression. Capture-focused storage/recording/uploader/save checks: 49 passed. API isolated SQL bundle/transcript/question-fencing checks: 30 passed. Web typecheck and production build passed.

At 390×844 the restored secondary link field had no horizontal overflow; Add and Cancel link each measured 44px. [Restored link draft](link-draft-restored-mobile.jpg) shows that state. Current desktop browser checks supplement, not replace, the previously recorded iOS/Android simulator evidence. They do not establish AWS bucket policy, physical audio quality, noisy speech accuracy or a deployed release; those limits remain recorded under A03/Q03.

Q01 passes within the owner's physical-device deferral. The wider review, sharing, avatar and delivery goal is not complete.
