# Drafts after reload (L10): design, and why nothing ships yet

Chat (`ConversationPanel.tsx`) and share-card (`PrincipleShare.tsx`) drafts are stamped
with a `writer` minted per MOUNT. An edit to a draft another writer stored is forked under
a new key, so two tabs never overwrite each other. A reload, closing and reopening the
chat, or switching away and back (Home keys the panel by conversation) is a new mount.

## The cases
1. **Sent message comes back.** Restore draft O, type, so it forks to F. Send F, the
   server confirms, F's key is cleared. On the next mount O is the newest draft, so the
   words you already sent are back in the box.
2. **Chain.** Two mounts before sending give O, then F1, then F2. Clearing "the draft
   this mount restored" removes F1 only. O still comes back.
3. **Edited words.** After a reload you change or delete some of O's words, then send.
   What was sent does not contain O, so a rule keyed by the sent words can't match O.
4. **Discarded card comes back.** Restore card O, change a setting so it forks to F,
   then confirm Discard. F is cleared and O returns on the next mount. Before you
   discard, the picker already lists both.
5. *Not bugs:* sending or discarding a restored draft without editing it clears its own
   key. A draft with attachments is carried, not forked, so its key is the one cleared.
   A pending draft can't be edited, so it never forks.

## Rules considered (none is small AND covers every case)
- **A. On confirm or discard, compare-and-delete the origin** (the key this mount
  restored, only if its bytes are unchanged). Fixes 1 and 4. Misses 2 unless each draft
  stores a `from` lineage. And it deletes the stored copy of a draft that another
  OPEN tab is still showing, when that tab is idle. That tab's words survive only
  in memory until its next keystroke. This is the "deleting an open tab's draft"
  failure that was cut from `claude/fix-web-bugs`.
- **B. Move on fork** (delete the origin when the fork is first written). Fixes 1, 2
  and 4, with the same open-tab deletion, and earlier: a tab that only displayed the
  draft loses it from storage before anything is sent.
- **C. On confirm, sweep every non-pending, attachment-free draft whose words are
  contained in what was sent.** Never deletes unsent words. Fixes 1 and 2 when you only
  added words. Misses 3, and doesn't apply to 4 (a card has no "sent words").
- **D. A per-tab writer in `sessionStorage`** (so a reload is not a new writer). Duplicating
  a tab copies `sessionStorage`, so two live tabs share one writer. The store's
  "changed in another tab" check then fails, and sending is blocked. Fixing
  that needs a pagehide handoff or a claimed-flag: a persisted coordination flag, the
  pattern that caused the duplicate and lost-words bugs in save recovery
  (`docs/plans/save-recovery.md`, commit 0367b142).

Telling "this tab's own earlier draft" apart from "a draft an open tab still holds" needs
either cross-tab coordination (leases, tombstones, storage-event writes) or a persisted
per-tab identity. Both are ruled out. Each storage-only rule above either leaves a case
open (C) or can delete another live tab's stored draft (A and B).

## Decision
**Docs only.** No code change on `claude/followup-drafts`. L10 stays open and now lists
cases 1–4. If the founder accepts one trade-off, the smallest step is **C** for chat
(it never loses words; it misses only case 3). It would ship with a test that types
after a remount, sends, remounts, and expects an empty box. The card would get **A**,
which is behind a confirm dialog. Either one is a product decision to accept a
known residual, not a bug fix that removes this one.
