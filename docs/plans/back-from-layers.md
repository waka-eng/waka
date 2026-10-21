# Back from layers: Back is caught, not stacked

**Problem.** A layer is a state with no address of its own, such as a saved note open inside the archive.
Back from it skips the layer and leaves the address beneath it. Every earlier fix gave the layer its own
history entry. That entry then had to be kept true through replaces, reloads, other ways of closing and
stacking, and it went wrong in each of those (see `docs/known-issues.md`).

**Rule. A layer never adds a history entry.** Each open layer registers a closer on a stack
(`lib/back-layers.ts`). The module listens to `popstate` before the router does. A pop is caught
only if all of these hold: a layer is open, the pop is one step back (the router's `idx` drops by
exactly 1 from the entry we were on), and the app did not ask for the pop itself. When it is caught,
the module:

1. stops the event, so neither the router nor Home's own listeners hear it;
2. writes the entry we were on back with `pushState`, copying its `{usr, key, idx}` and address
   exactly (taken after every router commit), so the router's location and key never change;
3. calls the topmost layer's closer. The layer leaves the stack when it really closes.

The history is then the same shape it would have had with no layer open. Only one thing is lost:
the forward entry the pop came from.

| Case | What happens | Why the old failure cannot happen |
|---|---|---|
| Back from an open note | The note commits and closes. The list stays, at the same key. | No new key, so Home's view restore never runs. |
| Back from the list | No layer is open, so the router pops as usual and the archive closes. | Nothing to skip. |
| Reload with a note open | The note is not restored (as on dev). History holds only the router's own entries. | No marker entry exists, so nothing has to be stripped or stepped over, and nothing loads twice. |
| Replace while a layer is open (seek query, wall switch, `?open=` cleanup) | The replace rewrites the real entry. The copy is taken after it, so Back writes back the new address. | No entry sits above the page entry, so nothing needs rebasing and there is no extra step. |
| Two stacked layers (archive + note, or any two registered) | Each Back closes the topmost layer. When none is left, the router pops. | Closers live on a stack, not in history, so closing them out of order leaves nothing behind. |
| The note cannot close (save failed or in flight) | It stays registered, so the next Back retries the commit. The words stay. | No entry was used up. |
| Note A to note B, archive closed under a note, delete | Nothing to clean up. The layer unregisters when it unmounts. | There are no stale entries. |
| App's own `navigate(-1)` (Escape, Now, close) | `expectAppPop()` lets the next pop through. | The Now row's close is never mistaken for Back. |
| Long-press Back several steps, or Forward | The `idx` delta is not -1, so the pop goes through. Home commits the note as on dev. | The user's chosen jump is never redirected. |

**Never** called: `history.back()`, `history.go()` or `replaceState`. The only `pushState` is the one
in step 2, made while handling the user's own Back.

**What it does not fix (stays open).** A pop that crosses documents raises no `popstate`. So when the
archive's entry is the first in its document (a cold `/?open=saves` link, or after a reload), Back from
an open note still leaves the archive, as on dev. The settings/info corner card sits on the root
entry, which has nothing in the same document beneath it, so it is not registered. Making it close
on Back still needs a real address.

**Browser checks still owed.** The iOS edge-swipe shows the snapshot of the previous page for a moment
before the list stays. Chrome may skip back over entries that were pushed without a user gesture; the
person has always pressed something before a note opens, but this has not been tested in Chrome.
