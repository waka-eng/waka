# Back from layers: the "catch Back" attempt, and why it was withdrawn

**Problem.** A layer is a state with no address of its own, such as a saved note open inside the
archive, or the settings/info corner card. Back from it skips the layer and leaves the address
beneath it. Earlier attempts gave each layer its own history entry. Each of those failed (see
`docs/known-issues.md`):
- a same-URL entry re-ran Home's view restore;
- a replace dropped the entry's mark;
- stale entries became dead Back presses;
- stepping back over a reloaded entry crossed into the previous document;
- rebasing under a router replace needed an asynchronous silent pop, which a second replace or a
  push could race;
- stacked layers left entries that no listener owned.

**This attempt (`claude/followup-back`, withdrawn; no code shipped).** It added no entry per layer.
The plan was for a module-level `popstate` listener to catch the person's one-step Back while a
layer was open. It would `pushState` back an exact copy of the entry they were on (router state,
key and idx) and close the topmost registered layer. Only the saved note was ever registered.
The corner card was never wired, and review no longer exists on dev. In jsdom the tests passed for
these cases: Back from a note returns to the list, the next Back leaves the archive, a reload has
no marker to strip, and a replace has nothing above it to rebase. Stacking (one layer closed per
Back) was shown only with synthetic layers in a unit test, never with two real layers.

**Why it fails in the real app.**

1. **Listener order.** The design needed its listener to run before the router's. `Home` is loaded
   with `lazy()`, so `back-layers.ts` is evaluated only after `BrowserRouter` has registered its
   own `popstate` listener (in a layout effect at mount). So the router hears every pop first,
   and `stopImmediatePropagation` comes too late. Every caught Back therefore desyncs: the router
   takes location N-1, the `pushState` puts the URL back at N, and the layer closes. The page
   renders one address while the bar shows another.
2. **Chrome's history-manipulation intervention.** A `pushState` made inside a `popstate` handler
   has no user activation of its own. Chrome then marks the entry the push was made from (N-1)
   as skippable. For the saved note, N-1 is Home, so a later Back skips Home. For a layer opened
   directly over Home, N-1 is the entry before Home, and a later Back can leave WAKA.
3. **Forward history is lost.** Pushing from entry N-1 discards every forward entry, not just the
   one the pop came from. Back then Forward no longer works, and anything further forward is gone.

The jsdom suites missed all three, and only two of those misses come from jsdom itself. The unit
suite imported the module directly, so it never ran with lazy-route listener order. jsdom has no
history-manipulation intervention. Forward history was a gap in the tests, not in jsdom: jsdom has
a real session history with forward entries, so forward-history regressions can and should be
tested there.

**What a viable approach needs.**

- **Router-level integration, not a side listener.** The layer has to be something the router
  owns: a real address (a query param such as `note=<id>`, read by the router and ignored by
  Home's view restore when only that param differs), or a data router's blocker/`unstable_usePrompt`-style
  hook that decides before the location commits. Listener order must be guaranteed by
  construction, not by the order modules load.
- **No `pushState` or `go()` outside a user gesture.** Entries are created only in response to a
  press. Back must only ever pop, never pop-then-push.
- **Replace under a layer and closing an archive over a note** still have to be answered without
  async rebasing. That is the open case for the address approach (`docs/known-issues.md`).
- **Real-device testing before review:** an iOS Safari edge-swipe (snapshot and swipe-back),
  Chrome desktop and Android Back (including the intervention, with and without a prior
  gesture), long-press Back history, Forward after Back, reload with a layer open, and a cold
  `/?open=saves` link. jsdom green is not evidence for any of these.
