# Save recovery — design note

Follow-up to "Save recovery redesign" in `docs/known-issues.md`. Design first, then the minimum.

## What a person sees on dev

**The composer jams after an offline save** (usability audit item 1). Save is pressed, the journal
is written, the network drops. The bar says "Couldn't confirm the save" and Save stays disabled.
Reconnecting and reloading only READ `GET /inspirations/save-requests/:id`; it answers 404
`save_not_found`, the journal is kept, and nothing is ever re-sent. Only pressing Retry gets out.

## What this PR does (and only this)

Only **this tab's own saves** are ever re-sent: request ids created by `start()` are kept per tab in
`sessionStorage` (survives a reload of that tab, nothing else), snapshotted at first mount.

- **First page load** reads this tab's own journal from disk and re-POSTs it, same id and body.
  Effect re-runs (`enabled`/`prefix` changes) only read; one after a POST was issued never re-POSTs.
- **`online`** re-POSTs this tab's own pending journal under the same id.
- If the tab is hidden or a run is in flight, that resend is owed (in-memory flag), consumed only by
  this tab's own visible, idle scan of its own journal (focus/visibility, or the end of the run).
- Another tab's journal is only read, on every path (load, online, refresh, storage, focus).
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
| Cross-tab journals | A tab re-sends only journals it created (per-tab `sessionStorage` ids); another tab only reads them, as on dev. Open: an orphaned journal (its tab closed) is never re-sent by another tab, only by Retry there; a duplicated browser tab copies `sessionStorage` and so shares ownership (server dedupes). |
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
