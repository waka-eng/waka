# Save recovery — design note

Follow-up to "Save recovery redesign" in `docs/known-issues.md`. Design first, then the minimum.

## What a person sees on dev

1. **The composer jams after an offline save.** Save is pressed, the journal is written, the network
   drops. The bar says "Couldn't confirm the save" and Save stays disabled. Reconnecting, refocusing
   and reloading only READ `GET /inspirations/save-requests/:id`; it answers 404 `save_not_found`, the
   journal is kept, and nothing is ever re-sent. Only pressing Retry gets out.
2. **409 `save_request_conflict` jams the same way.** It is a refusal, but the hook calls it
   "uncertain" and keeps the journal forever.

## The rules

- The server is idempotent on (profile_id, request_id) and answers a concurrent same-id POST with 409
  `save_in_progress`. So recovery is **re-POST the same id with the body read from disk**: on a
  press, Retry and page load; on focus/`online` only for a journal this tab sent or whose persisted
  `sentAt` is over 30s old. A **storage event only reads** the status (its writer is open, sending).
- 409 `save_in_progress` is **still saving**, never "Couldn't confirm": stay busy and re-send the same
  id with a short backoff (1s doubling to 8s) until it lands or is refused.
- A journal leaves disk only when its id **lands** (2xx), is **definitively refused** (400 validation
  or 409 `save_request_conflict` — the full input is offered back by "Edit"), is **removed** (410), or
  the person **discards** it. Never on 404, 5xx, a timeout or a network error.
- No "did not land" inference, no tombstones, no persisted pressed flag, no displaced tracking.
  Cross-tab is reading the journal from disk (plus its `sentAt`) before acting.
- A tab whose in-memory journal is gone from disk (another tab settled it) reads it once — found
  resolves the view, 404 lets the memory go (landed, refused or discarded cannot commit later).
- The tab that pressed acknowledges (`initiated`), whichever path lands it; ids pressed are kept in
  memory only. Other tabs and fresh page loads never report a press.

## The cases from known-issues

| Case | Handled how |
| --- | --- |
| Gateway 5xx vs our 500 | Not distinguished, and no longer needs to be: every 5xx keeps the journal; the next re-POST of the same id either commits or replays. |
| "Not found" is not "did not land" | 404 never releases a journal; it only leads to a same-id re-POST, which the server dedupes. |
| Cross-tab journals | A tab does not adopt a journal while its owner is open: storage events only read, and focus re-sends another tab's journal only once its `sentAt` is 30s stale. A page load still re-sends; a race there gets 409 `save_in_progress` (polled) or a replay. `start` refuses a new journal while any is on disk. Write-backs over a newer write: still open. |
| 409 `save_request_conflict` | Refusal: marked rejected, "Edit" offers the words back and removes it. |
| "Save as new" while pending | Not offered: Save stays disabled while a journal is pending, as on dev. Open. |
| The why (photo reflections) | Still cleared at the press; a refusal's "Edit" restores text only. Open. |
| Same words, current draft revision | Unchanged from dev. Open. |
| Acknowledging a press | Pressed ids live in memory in the pressing tab, which gets `initiated=true` however the save lands; other tabs and page loads get false. A press queued behind a background send is dropped (Retry is hidden while busy). |
| 410 `saved_item_removed` | Unchanged: `onRemoved` settles the draft. Now also reached from a re-POST, which answers 410 too. |
| Sign-out | Unchanged: `pendingSave:` is kept across sign-out by design; nothing new holds words. |

## Still open after this PR

The why, "Save as new", same-words/current-revision, write-backs over a newer write, and a Discard
for an uncertain save (the journal can still only be released by landing, refusal or removal).
