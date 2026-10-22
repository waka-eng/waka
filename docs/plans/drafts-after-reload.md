# Drafts after reload (L10): the cases, and the per-tab lineage that fixes them

Chat (`ConversationPanel.tsx`) and share-card (`PrincipleShare.tsx`) drafts are stamped
with a `writer` minted per MOUNT. An edit to a draft another writer stored is forked under
a new key, so two tabs never overwrite each other. A reload, closing and reopening the
chat, or switching away and back (Home keys the panel by conversation) is a new mount.

## The cases
1. **Sent message comes back.** Restore draft O, type, so it forks to F. Send F; the
   server confirms and F's key is cleared. O stays on disk. *Existing chat:* the next
   mount of that chat restores O. *New chat:* drafts live under `new:<principleId|general>`,
   and after the send `onChoose(next.id)` moves you to the new conversation's storage.
   So O returns in the NEXT new chat from that place, not in the one you just sent.
2. **Chain.** Two mounts before sending give O, then F1, then F2. Clearing "the draft
   this mount restored" removes F1 only. O still comes back.
3. **Edited words.** After a reload you change or delete some of O's words, then send.
   What was sent does not contain O, so a rule keyed by the sent words can't match O.
4. **Discarded card comes back.** Restore card O and fork it, then confirm Discard. F
   is cleared and O returns on the next mount. Two paths fork: (a) you change a setting;
   (b) in change mode, with no edit at all, when `beforeStatementId` is null and an
   earlier statement exists, the mount effect (~line 109) calls `update()`. The picker
   lists both drafts before you discard.
5. *Not bugs:* sending an unedited restored chat draft, or discarding an unforked
   restored card, clears its own key. A draft with attachments is carried, not forked.
   A pending draft can't be edited, so it never forks.

## Rules considered (none is small AND covers every case)
- **A. On confirm or discard, compare-and-delete the origin** (the key this mount
  restored, only if its bytes are unchanged). Fixes 1 and 4; misses 2 unless each draft
  stores a `from` lineage. It deletes the stored copy of a draft an idle OPEN tab still
  shows. That is the failure cut from `claude/fix-web-bugs`.
- **B. Move on fork** (delete the origin when the fork is first written). Fixes 1, 2 and
  4, with the same open-tab deletion, and earlier.
- **C. On confirm, sweep every non-pending, attachment-free draft whose words are
  contained in what was sent.** Never deletes unsent words. Fixes 1 and 2 when you only
  added words. Misses 3, and doesn't apply to 4 (a card has no "sent words").
- **D. A per-tab writer in `sessionStorage`, snapshotted once per page.** This is the
  identity dev already ships for saves (`OWN_SAVES` in `lib/use-authored-save.ts`,
  PR #452). There it is accepted with one open residual: a duplicated tab
  (`docs/plans/save-recovery.md`). The save-recovery bugs came from tombstones,
  storage-event sends, the persisted pressed flag and `sentAt`, not from the per-tab
  id, which commit 0367b142 kept while cutting those. With D, a reload or remount in
  the same tab is the same writer, so O is carried, not forked. That fixes 1 (both
  variants), 2, 3 and 4(a)/(b) for drafts this tab wrote, and it needs no coordination.
  **Residuals:** (i) a duplicated tab shares the writer, so the second tab hits the
  store's "changed in another tab" refusal (storage-failed alert, send blocked) instead
  of forking. (ii) A draft written by a tab that has since closed, or before a browser
  restart (a new `sessionStorage`), still forks. So case 1 still happens for yesterday's
  draft. (iii) Drafts already on disk carry old per-mount writers and fork once.

## Decision (first round, `claude/followup-drafts`)
Docs only; D was named the viable candidate. Corrections from that PR's final review
(#456): saves ship `OWN_SAVES` (request ids this tab created), not a tab writer id, so
D is new code modelled on it; attaching the first photo (`draftForAttaching`) and
"Keep draft" after a storage failure (`update(draft.value)`) also fork.

## What shipped (`claude/drafts-lineage`): D as a per-tab lineage
Forks still happen exactly as before; what changed is that this tab remembers them.
- `lib/draft-lineage.ts` keeps, in sessionStorage under the account and profile
  scope (`waka.profile:<account>:<profile>:draftLineage:forks`), one row per fork this
  tab stored, `{key: F, from: O, print: fingerprint of O's bytes when forked}`, last
  50, only between two drafts of one place (one chat journal). It also keeps
  `…:draftLineage:mine`, key → fingerprint of the bytes this tab last wrote there
  (like `OWN_SAVES`' own request ids), last 100. A fork is linked ONLY when O's
  restored bytes are exactly what this tab last wrote at O; a reload of the same tab
  keeps the map, so the reload chain is linked. A draft another tab wrote is never
  linked, including one it rewrote under a key this tab made (a draft with photos
  keeps its key when edited) — reviews on f4091472 and 00a2c1d6: sending here deleted
  another open tab's words.
- **No words are kept** (security review on 00a2c1d6): only draft keys and cyrb53
  fingerprints, compared for "unchanged since the fork" and "these are this tab's
  bytes". Sign-out (`clearUnsentDrafts`) removes both records for that account.
- **Chat:** `keep()` records every store, and a fork when it lands under a new key over
  a draft this tab stored — an edit
  or the first photo on a restored draft. When `observe()` confirms the send it
  clears the current draft and `clearDraftLineage(key)`: every recorded ancestor,
  through any chain, by compare-and-delete on the recorded bytes. A new chat's
  drafts live under `new:<principleId|general>` and so does their lineage, so the
  next new chat is empty.
- **Share card: left as dev behaviour (case 4 not changed).** Discard clears only the
  card on screen. Unlike a sent chat message, the original card O stays visible: the
  Drafts picker lists it as its own choice, which the person may be keeping on
  purpose, so deleting it with its fork F would discard a card nobody discarded.
  (Code review on 04148948 found this in a first version that cleared card lineage.)
  No card fork is recorded.
- A draft with no recorded link to the one cleared (any draft another tab wrote,
  another chat) is never touched. No tombstones, no storage events, no leases.

Tests: `test/draft-lineage.test.ts`, `test/chat-drafts-lineage.test.tsx` (existing
chat, next new chat, a chain of three, edited words, attach-then-send, another tab's
draft kept, another tab's idle draft restored, forked and sent here kept),
`test/share-drafts-lineage.test.tsx` (fork a card, discard the fork: the
original is still in the picker).

**Residuals (accepted):** (0) case 4 as above: a discarded card's original stays, by
design, in the picker. (i) a duplicated tab copies the list, so either copy may
clear what the other forked from. (ii) A closed tab's list is gone (and a browser
restart is a new sessionStorage), so a fork made there leaves its original behind:
"came back the next day" still happens when the fork was made in a tab since closed.
(iii) Forks stored before this shipped have no recorded line and come back once.
(iv) A draft another tab wrote is never linked, so restoring it here, editing and
sending leaves it on disk, and it comes back on this chat's next mount (dev's
behaviour, now only for another tab's drafts). (v) A draft THIS tab wrote that another
open tab has restored and is showing unedited is cleared from storage when this tab
sends its fork; that tab still shows the words (already sent from here) and keeps
them only if it edits before reloading or closing.
