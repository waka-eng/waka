# Back from layers: the "catch Back" attempt, and why it was withdrawn

**Problem.** A layer is a state with no address of its own, such as a saved note open inside the
archive, or the settings/info corner card. Back from it skips the layer and leaves the address
beneath it. Earlier attempts gave each layer its own history entry. Each of those failed (see
`docs/known-issues.md`): the entry re-ran Home's view restore, a replace dropped its marker, stale
entries became dead Back presses, `history.back()` on reload crossed documents, rebasing under a
replace stepped back twice, and stacked layers mis-read pops.

**This attempt (`claude/followup-back`, withdrawn; no code shipped).** It added no entry per layer.
The plan was for a module-level `popstate` listener to catch the person's one-step Back while a
layer was open. It would `pushState` back an exact copy of the entry they were on (router state,
key and idx) and close the topmost registered layer. In jsdom this passed every case: Back from a
note returns to the list; the next Back leaves the archive; a reload has no marker to strip; a
replace has nothing above it to rebase; stacked layers close one per Back.

**Why it fails in the real app.**

1. **Listener order.** The design needed its listener to run before the router's. `Home` is loaded
   with `lazy()`, so `back-layers.ts` is evaluated only after `BrowserRouter` has registered its
   own `popstate` listener (in a layout effect at mount). The router hears the pop first and
   commits the popped location. Then either `stopImmediatePropagation` is too late and the fix
   does nothing, or the `pushState` that follows leaves the URL and the router out of sync.
2. **Chrome's history-manipulation intervention.** A `pushState` made inside a `popstate` handler
   has no user activation of its own. Chrome then marks the entry beneath it as skippable, so a
   later Back can skip Home and leave WAKA altogether.
3. **Forward history is lost.** Pushing from entry N-1 discards every forward entry, not just the
   one the pop came from. Back then Forward no longer works, and anything further forward is gone.

The jsdom suites could not see any of these. They imported the module directly, so they never had
lazy-route listener order, and jsdom has neither the intervention nor real forward stacks.

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
