/**
 * WHAT THE NEXT PERSON AT THIS BROWSER MUST NOT BE ABLE TO READ.
 *
 * Draft text is kept on the device so that a closed tab, a crash, or a dead
 * network does not cost the person the sentence they were in the middle of.
 * That is the right trade for a signed-in owner and the wrong one the moment
 * they sign out: a shared laptop, a library machine, a handed-over phone, and
 * the words the previous person had not decided to send are still sitting
 * there — in a half-written save, or in a message to a room, which is the
 * material most likely to be unsent precisely because it was not settled.
 * Nothing about logout used to touch them.
 *
 * NARROW ON PURPOSE, and the line is "did the person decide this leaves?"
 *
 *   - Cleared: the save box's text and the IndexedDB copy beside it (links,
 *     photos, voice recordings); every chat composer this profile left
 *     half-typed; a principle card being composed to share; and three key
 *     namespaces from the retired review surfaces — see the list below for why
 *     those are still swept. Unsent by definition, every one.
 *   - NOT cleared: `pendingSave:` and the `unrecovered…`/`…Recovery:` backups.
 *     Those hold work the person DID submit, kept so that a save interrupted
 *     by a dead network is not silently lost — evicting them on logout would
 *     turn a privacy fix into a data-loss bug, and would do it in exactly the
 *     case (flaky network, person gives up and signs out) the backups exist
 *     for. Every prefix below ends in `:` for this reason and no other:
 *     `reviewSelection:` must not also match `reviewSelectionRecovery:`.
 *   - NOT cleared: anything a returning owner expects to find — their
 *     language, whether the last keep was public, where they had scrolled to.
 *     Those are settings and positions, not words withheld from anyone.
 *
 * WHY THE PREFIXES ARE LISTED HERE rather than each store exporting its own
 * sweep: logout does not know the ids. The keys are per inspiration, per
 * review, per principle, and the ids live in the keys — which is what makes a
 * prefix sweep the right instrument rather than a list we would have to keep
 * somewhere and keep correct. Listing them in one place also means the
 * cleared/kept decision above can be checked by reading one array.
 *
 * Keys are already scoped per account and per profile, so this clears one
 * person's drafts and leaves another profile signed into the same browser
 * alone.
 *
 * ── WHAT LOGOUT WAITS FOR, AND WHAT IT REFUSES TO WAIT FOR ─────────────────
 *
 * `localStorage` is synchronous, so every key above is gone before this
 * function returns its promise — before the first `await`, deliberately, so a
 * caller that forgets to await still gets the whole localStorage sweep. That
 * matters because the tab may be closed a millisecond later.
 *
 * The save box's IndexedDB copy cannot work that way: it is a transaction, it
 * can fail, and it can hang. So logout DOES await it, and awaits it under a
 * deadline. Both halves of that are chosen:
 *
 *   - Awaiting, because this is the store holding photographs and voice
 *     recordings, and "best effort, started, unobserved" is not a claim worth
 *     making about those. The wait is invisible on web — `applyViewer(null)`
 *     has already run, so the person is looking at the signed-out screen while
 *     this finishes.
 *   - Under a deadline, because `logout()` is awaited by the UI, and an
 *     IndexedDB open that never answers (another tab holding an older version
 *     open is the documented way this happens) would otherwise leave a person
 *     watching a control that never completes. Being unable to tidy up is not
 *     a reason to keep somebody signed in, and it is not a reason to leave
 *     them in a surface with no exit either.
 *
 * The eviction is NOT cancelled when the deadline passes; it is only stopped
 * being waited on. If it lands a second later it still lands.
 *
 * A failure is swallowed rather than surfaced, which is the same rule the
 * localStorage sweeps follow: logout itself can never fail for this.
 */
import { clearAllConversationDrafts } from './conversation-drafts';
import { clearInspirationDrafts } from './inspiration-draft-store';
import { profileStorageKey, writeProfileText, type ProfileStorageScope } from './profile-storage';

/**
 * Long enough that a working store always finishes inside it (these are a
 * handful of rows, keyed and indexed), short enough that a wedged one is not
 * mistaken by the person for the product being stuck.
 */
const INDEXED_DB_EVICTION_DEADLINE_MS = 2_000;

/**
 * Unsent words that live under per-id keys. Each entry is the whole prefix
 * after the profile scope, trailing `:` included — see the header for why that
 * colon is load-bearing.
 *
 * THREE OF THESE FOUR NO LONGER HAVE A WRITER, and that is a reason to sweep
 * them, not a reason to drop them. The reflection flow and the review surfaces
 * were removed from the product on 2026-10-10; the keys they wrote are still
 * sitting in every browser that used them before that, holding sentences their
 * authors never submitted. An eviction list is about what a device HAS, not
 * about what the current build can produce — deleting a line here because the
 * feature is gone would leave that material on the machine forever, and the
 * person who typed it has no way to know. Each line says which case it is, so
 * nobody has to guess whether it is live.
 */
const UNSENT_KEY_PREFIXES = [
  /* RETIRED SURFACE. The answer being written to a reflection question. */
  'reflectionDraft:',
  /* RETIRED SURFACE. A review answer mid-sentence, or one being withdrawn. */
  'reviewDialogue:',
  /* RETIRED SURFACE. The memories someone picked to review together. */
  'reviewSelection:',
  /* LIVE: `principle-artifact-drafts.ts`. A principle card being composed to
     share, carrying the person's own rewording of their statement. */
  'principleArtifact:',
] as const;

function clearPrefix(scope: ProfileStorageScope, prefix: string): void {
  const base = profileStorageKey(scope, prefix);
  if (!base) return;
  /* Collected before removing: mutating the store while enumerating it by
     index is how a sweep skips every other key. */
  const doomed = Object.keys(localStorage).filter(key => key.startsWith(base));
  for (const key of doomed) localStorage.removeItem(key);
}

export function clearUnsentDrafts(scope: ProfileStorageScope | null): Promise<void> {
  if (!scope?.accountId || !scope.profileId) return Promise.resolve();
  /* Each store independently: a browser that refuses one (Safari private mode
     throws on write, and enumerating keys can throw too) must not keep the
     other's words on the machine. Logout itself can never fail for this —
     being unable to tidy up is not a reason to leave the person signed in. */
  try { writeProfileText(scope, 'draft', ''); } catch { /* best effort */ }
  try { clearAllConversationDrafts(scope); } catch { /* best effort */ }
  for (const prefix of UNSENT_KEY_PREFIXES) {
    try { clearPrefix(scope, prefix); } catch { /* best effort */ }
  }

  /* Everything above has already happened by the time this promise exists. */
  let evicting: Promise<unknown>;
  try { evicting = clearInspirationDrafts(scope); }
  catch { return Promise.resolve(); }

  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, INDEXED_DB_EVICTION_DEADLINE_MS);
    void evicting
      .catch(() => { /* a store that cannot be emptied must not fail the logout */ })
      .finally(() => { clearTimeout(timer); resolve(); });
  });
}
