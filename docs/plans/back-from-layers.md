# Back from layers: the "catch Back" attempt, and why it was withdrawn

**Update (`claude/note-address`, 2026-10-21): the saved note now has a real address.** Opening a
note in the archive pushes `?open=saves&note=<id>`; Back pops to the list and the next Back leaves
the archive, through the router's ordinary history. No `popstate` catching, no `pushState` outside
a press. What it took, beyond the param (`lib/view-location.ts`, `lib/use-view-navigation.ts`,
`SavesOverlay`'s `note`/`onNoteAddress`, `Home`):

- `note=` is read and written only beside `open=saves`, so it cannot ride onto another page.
- The pushed entry records `noteFrom` (the list's address) and which page load pushed it.
  `closeNote` (the on-screen way back, a delete, an unchanged close) is `navigate(-1)` when the
  list is beneath, a replace to the list on a cold link. `closeOpen` from a note steps over both
  entries (`go(-2)`) when the archive has an origin; without one (cold `?open=saves`, or the dock's
  new-note → All inspirations path, which replaces) it steps back onto the list and rewrites the
  list to the world.
- **Replace under the note, answered:** a replace that drops the note (the bar moving you on)
  first steps back onto the list and replaces that, so no list entry is left to reopen the archive.
  The step is a traversal, made only when the list is this document's (a pre-reload entry would
  be a full load and the act would be lost; then it replaces in place). A replace that keeps the
  note but rewrites the rest is refused, so the list never holds a stale address; the
  canonicaliser records again once the note closes.
- Home's view restore skips an entry that differs from the applied one only by `note=`.
- Leaving the address commits the note through `commitOpenNote` (the popstate listener, plus an
  effect for traversals that raise no `popstate`); its identity guard makes them one write.
- **Event order, in real browsers:** the pop reaches Home's listener before the router lands, so
  the note let go of by the pop must not also be "closed on screen" (that was a second Back, past
  the list, in both engines). A close is ignored while a pop or a traversal from that entry is
  still landing.

Verified in Chromium and WebKit (`pnpm e2e:back-from-a-note`: production build, `/api` stubbed in
the page): archive → note → Back (list) → Back (archive closed); Back/Forward reopens the note;
reload with a note open keeps it and Back still reaches the list then Home then the page before;
Forward history intact after the walk; Back from an edited note sends one PATCH; `history.length`
never grows on any Back or close. **Not covered:** real iPhone edge-swipe, Android system Back,
long-press Back. **Still open, pre-existing:** closing the archive opened by the dock (new note →
All inspirations, a replace) leaves no origin, so its close replaces the list with `/` and the next
Back is a same-URL step; from a note it is the same, no worse. Review, the settings/info card,
`prov` and the share sheet are unchanged and still address-less.

---

**Problem.** A layer is a state with no address of its own: on dev, review, the claim-roots sheet
(`prov`, over review), the share sheet (`thingShare`), a saved note in the archive, and the
settings/info card. Back skips the layer. (The memory/detail panel has an address,
`?inspiration=<id>`, so its Back already works.) Earlier attempts gave each layer its own history
entry and failed (`docs/known-issues.md`): a same-URL entry re-ran Home's view restore; a replace
dropped the mark; stale entries were dead Backs; stepping back after a reload crossed documents;
rebasing under a replace needed an async pop a second replace could race; stacked layers left
orphan entries.

**This attempt (`claude/followup-back`, withdrawn; no code shipped).** It added no entry per layer.
A module-level `popstate` listener caught the person's one-step Back while a layer was open,
`pushState`d back an exact copy of the entry (router state, key, idx) and closed the topmost layer.
Only the saved note was registered; the other layers never were. jsdom tests passed: Back from a
note returns to the list, the next Back leaves the archive, a reload has no marker to strip, a
replace has nothing above it to rebase. Stacking was shown only with synthetic layers in a unit
test, never with two real layers.

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
3. **Forward history is lost.** Pushing from N-1 discards every forward entry; Forward breaks.

Only one of these three misses is jsdom's own: it has no history-manipulation intervention. The
other two were test gaps. The unit suite imported the module directly, so it missed the listener
order; loading Home through the real lazy route in jsdom would have shown it. jsdom has a real
session history with forward entries, so forward-history regressions can be tested there.

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
- **Replace under a layer stays open even with real addresses.** A pushed layer address sits on a
  page entry that keeps the pre-replace address. Example: switch wall under `?note=`, then Back
  restores the old wall. Rewrite both entries, or forbid address-changing replaces while a layer
  is pushed.
- **Real-device testing before review:** iOS Safari edge-swipe, Chrome desktop and Android Back
  (the intervention, with and without a prior gesture), long-press Back, Forward after Back,
  reload with a layer open, and a cold `/?open=saves` link. jsdom green is not evidence for these.
