# Back from layers: the "catch Back" attempt, and why it was withdrawn

**Problem.** A layer is a state with no address of its own. On dev the layers are review, the
open memory/detail panel, a saved note open inside the archive, and the settings/info corner
card. Back from a layer skips it and leaves the address beneath it. Earlier attempts gave each
layer its own history entry, and each failed (`docs/known-issues.md`): a same-URL entry re-ran
Home's view restore; a replace dropped the mark; stale entries were dead Back presses; stepping
back after a reload crossed documents; rebasing under a replace needed an async silent pop that a
second replace or push could race; stacked layers left entries no listener owned.

**This attempt (`claude/followup-back`, withdrawn; no code shipped).** It added no entry per layer.
A module-level `popstate` listener caught the person's one-step Back while a layer was open,
`pushState`d back an exact copy of the entry (router state, key, idx) and closed the topmost
layer. Only the saved note was registered; review, the detail panel and the corner card never
were. jsdom tests passed: Back from a note returns to the list, the next Back leaves the archive,
a reload has no marker to strip, a replace has nothing above it to rebase. Stacking was shown only
with synthetic layers in a unit test, never with two real layers.

**Why it fails in the real app.**

1. **Listener order.** The design needed its listener to run before the router's. `Home` is loaded
   with `lazy()`, so `back-layers.ts` is evaluated only after `BrowserRouter` has registered its
   own `popstate` listener (in a layout effect at mount). So the router hears every pop first,
   and `stopImmediatePropagation` comes too late. Every caught Back therefore desyncs: the router
   takes location N-1, the `pushState` puts the URL back at N, and the layer closes.
2. **Chrome's history-manipulation intervention.** A `pushState` made inside a `popstate` handler
   has no user activation of its own. Chrome then marks the entry the push was made from (N-1)
   as skippable. For the saved note, N-1 is wherever the archive was opened from (`openFrom`):
   Home, a conversation or another destination. A later Back skips that entry. From a cold
   `/?open=saves` link the archive is the root entry, and Back is cross-document. For a layer
   opened directly over Home, N-1 is the entry before Home, and a later Back can leave WAKA. That
   only happens when Home was reached in-app; on the root entry Back raises no `popstate`.
3. **Forward history is lost.** Pushing from entry N-1 discards every forward entry, so Forward
   after Back no longer works.

The jsdom suites missed all three, but only one miss is jsdom's own: it has no
history-manipulation intervention. Listener order was a gap in the test design. The unit suite
imported the module directly; loading Home through the real lazy route in jsdom would have shown
it. Forward history was also a test gap. jsdom has a real session history with forward entries, so
forward-history regressions can and should be tested there.

**What a viable approach needs.**

- **Router-level integration, not a side listener.** The layer has to be something the router
  owns: a real address (a query param such as `note=<id>`, read by the router and ignored by
  Home's view restore when only that param differs). Listener order must be guaranteed by
  construction, not by the order modules load. A data router's blocker reverts a blocked POP
  with `history.go` traversals and never pushes, so it does not trip the add-entry intervention.
  It is still not a drop-in fix: it needs a migration from `<BrowserRouter>` to a data router,
  it cannot see a cross-document Back from the root entry (the corner card's case), and the
  revert may flash or animate on iOS. Real addresses remain the likely shape.
- **Never add a history entry (`pushState`) without user activation.** Entries are created only
  in response to a press, and Back never pops and then pushes. The intervention does not rule
  out traversals made without a gesture (`go`).
- **Replace under a layer becomes the router's ordinary case** once the layer is a real address.
  The replace rewrites the layer's own entry, there is no hidden entry beneath it to rebase, and
  no async pop is needed (`docs/known-issues.md`, "Likely shape of a fix").
- **Real-device testing before review:** iOS Safari edge-swipe, Chrome desktop and Android Back
  (the intervention, with and without a prior gesture), long-press Back, Forward after Back,
  reload with a layer open, and a cold `/?open=saves` link. jsdom green is not evidence for these.
