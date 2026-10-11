/**
 * WHAT THE NEXT PERSON AT THIS BROWSER MUST NOT BE ABLE TO READ.
 *
 * Draft text is kept in `localStorage` so that a closed tab, a crash, or a
 * dead network does not cost the person the sentence they were in the middle
 * of. That is the right trade for a signed-in owner and the wrong one the
 * moment they sign out: a shared laptop, a library machine, a handed-over
 * phone, and the words the previous person had not decided to send are still
 * sitting there — in a half-written save, or in a message to a room, which is
 * the material most likely to be unsent precisely because it was not settled.
 * Nothing about logout used to touch them.
 *
 * NARROW ON PURPOSE, and the line is "did the person decide this leaves?"
 *
 *   - Cleared: the save box's text, and every chat composer this profile left
 *     half-typed. Unsent by definition.
 *   - NOT cleared: `pendingSave:` and the `unrecovered…`/`…Recovery:` backups.
 *     Those hold work the person DID submit, kept so that a save interrupted
 *     by a dead network is not silently lost — evicting them on logout would
 *     turn a privacy fix into a data-loss bug, and would do it in exactly the
 *     case (flaky network, person gives up and signs out) the backups exist
 *     for.
 *   - NOT cleared: anything a returning owner expects to find — their
 *     language, whether the last keep was public, where they had scrolled to.
 *     Those are settings and positions, not words withheld from anyone.
 *
 * Keys are already scoped per account and per profile, so this clears one
 * person's drafts and leaves another profile signed into the same browser
 * alone.
 *
 * STILL OUTSTANDING, written down rather than left for the next audit to
 * rediscover: the save box ALSO keeps a copy in IndexedDB
 * (`inspiration-draft-store.ts`), with the text, pasted links, and any photo
 * or voice recording attached to it. Same exposure, different store, and
 * emptying it is an async transaction that can fail — which is a decision
 * about what logout may block on, not a line to add here quietly.
 */
import { clearAllConversationDrafts } from './conversation-drafts';
import { writeProfileText, type ProfileStorageScope } from './profile-storage';

export function clearUnsentDrafts(scope: ProfileStorageScope | null): void {
  if (!scope?.accountId || !scope.profileId) return;
  /* Each store independently: a browser that refuses one (Safari private mode
     throws on write, and enumerating keys can throw too) must not keep the
     other's words on the machine. Logout itself can never fail for this —
     being unable to tidy up is not a reason to leave the person signed in. */
  try { writeProfileText(scope, 'draft', ''); } catch { /* best effort */ }
  try { clearAllConversationDrafts(scope); } catch { /* best effort */ }
}
