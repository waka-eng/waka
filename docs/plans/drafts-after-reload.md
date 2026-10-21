# Drafts after reload (L10): design, and why nothing ships yet

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

## Decision
**Docs only.** No code change on `claude/followup-drafts`. L10 stays open and lists
cases 1–4. D is the viable candidate: small, already the product's tab identity, and
free of every failure pattern above. It still leaves residual (ii), which is the
common "came back the next day" path, so it does not avoid every case. Shipping D,
alone or with C to cover (ii), is a call to accept the residuals listed. Its tests
must cover remount-then-send for an existing chat AND for a new chat (assert the next
`new:` mount is empty), and discard after the change-mode auto-fork.
