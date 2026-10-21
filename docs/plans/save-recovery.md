# Save recovery — design note

Follow-up to "Save recovery redesign" in `docs/known-issues.md`. Design first, then the minimum.

## What a person sees on dev

**The composer jams after an offline save** (usability audit item 1). Save is pressed, the journal
is written, the network drops. The bar says "Couldn't confirm the save" and Save stays disabled.
Reconnecting and reloading only READ `GET /inspirations/save-requests/:id`; it answers 404
`save_not_found`, the journal is kept, and nothing is ever re-sent. Only pressing Retry gets out.

## What this PR does (and only this)

- **Page load** reads the journal from disk and re-POSTs it under its original id and body.
- **`online`** re-POSTs this tab's pending journal under the same id.
- **Retry** is unchanged from dev (re-POSTs the in-memory intent, same id).
- Focus and storage events still only READ, exactly as on dev. Load/online sends are not presses
  (`initiated=false`); Save and Retry are.
- `busy` clears when a superseded run ends, not only when the current run ends.

## The rules this relies on

- The server is idempotent on (profile_id, request_id): a committed id replays, a concurrent same-id
  POST gets 409 `save_in_progress`. So re-POSTing the same id + immutable body can never make a
  second copy.
- A journal is removed only when its id lands (2xx), is refused by validation (400, words offered
  back by "Edit"), is removed (410), or the person discards it. Never on 404, 5xx or a timeout.
- No "did not land" inference, no tombstones, no cross-tab coordination, no persisted pressed flag.

## The cases from known-issues

| Case | Handled how |
| --- | --- |
| Gateway 5xx vs our 500 | Not distinguished: every 5xx keeps the journal; a later same-id re-POST commits or replays. |
| "Not found" is not "did not land" | 404 never releases a journal; on load/online it leads to a same-id re-POST. |
| Cross-tab journals | Unchanged from dev, except a tab that LOADS while another is mid-send re-POSTs too: the server answers 409 `save_in_progress` (that tab shows "Couldn't confirm" until it lands) or a replay. Open. |
| 409 `save_request_conflict` | Unchanged from dev: "uncertain", journal kept. It can mean the id already landed, so it must never release the journal or offer the words back as new. Open. |
| 409 `save_in_progress` for the pressing tab | Unchanged from dev: "Couldn't confirm", no acknowledgement. Open. |
| "Save as new" while pending | Not offered, as on dev. Open. |
| The why (photo reflections) | Unchanged from dev. Open. |
| Same words, current draft revision | Unchanged from dev. Open. |
| Acknowledging a press | Load/online sends report no press; a press then answered by a later load/online resend is not acknowledged. Open. |
| 410 `saved_item_removed` | Unchanged: `onRemoved` settles the draft. |
| Sign-out | Unchanged: `pendingSave:` is kept across sign-out by design. |

## Cut after review (do not re-try without a design)

Storage-event reads vs sends, focus re-sends with a persisted `sentAt` / 30s rule, polling on
`save_in_progress`, treating `save_request_conflict` as a refusal (it can mean the id landed — a
duplicate path), a "gone from disk" scan mode, and in-memory pressed ids. Each round of these found
a new duplicate or a stuck `busy`.
