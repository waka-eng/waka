# The keyboard audit — the world with the mouse unplugged

**Date:** 2026-08-26
**Instrument:** `pnpm e2e:by-keyboard` (`tools/e2e/by-keyboard.ts`)

## Why the usability audit could not have covered this

The usability audit covered contrast, target sizes and the Nielsen
heuristics. It could not reach this question, because **the field is a
canvas**: an orb is painted pixels, not an element. There is nothing for Tab
to land on and nothing for a screen reader to announce, and no amount of
contrast checking notices that.

Every other walk in this repo drives a mouse — `dead-css` sweeps the canvas by
clicking a grid of coordinates, which is itself a confession that the things
it wants are not addressable any other way.

## The chrome is good, and that is the first finding

```
Tab reaches 8 stops in the world:

  lit   Maintaining a personal archive of ideas…   h1.jar-poster
  lit   your top of mind was written…              button.jar-mouth-rest
  lit   Me                                         button.jar-here
  lit   go to another wall                         button.jar-here-more
  lit   wind this wall back through time           button.jar-when
  lit   Your account                               button.jar-account
  lit   philosophies & values                      button.jar-values
  lit   3 inspirations                             button.jar-saved
```

**0 of 8 announce nothing. 0 of 8 show no visible focus.** Every stop has an
accessible name, and every stop lights up when focus lands on it — checked by
asking the browser for the focused element's computed outline and shadow
rather than by trusting that a rule exists somewhere.

`wind this wall back through time` and `go to another wall` are written for a
listener, not lifted from the visible glyph (`▾`, `now`). Somebody did this on
purpose.

**Keeping a memory with the keyboard alone works.** Tab to the mouth, Enter,
type, Enter — the row lands in the archive. The product's primary act is fully
reachable without a pointer.

## The finding: the archive is write-only without a mouse

**Opening a memory to read it did not work.** Verified twice, because it is a
strong claim:

1. The walk tabbed to the door, pressed Enter, then pressed Tab and Enter
   twenty-five times looking for any route into a memory. Nothing opened.
2. A direct probe of the opened archive lists every visible focusable element
   behind the door:

```
button.jar-mouth-rest: Capture inspiration
button.jar-here:       Me
button.jar-here-more:  go to another wall
button.jar-when:       wind this wall back through time
button.jar-account:    Your account
button.jar-up:         back up to the wall
```

Six controls, and **not one of them is a memory**. The orbs are canvas pixels
with no `tabindex`, no DOM proxy and no list behind them. The canvas itself
has no `tabindex` either, so a screen reader is not told a field exists at
all.

So a person who cannot use a pointer can put memories in and cannot get a
single one back out. For a product whose promise is that it keeps what you
give it and shows you what it read, that is the central act missing — not a
rough edge on the way to it.

**Not fixed here, because the fix is a design.** The shape of the answer is a
product decision with at least two credible forms:

- a DOM list behind the door — the archive as text, tabbable, each memory a
  real element, the canvas remaining the *view* rather than the only view;
- or roving focus on the canvas: one `tabindex`, arrow keys to move between
  orbs, the focused orb announced through a live region and drawn as focused.

The first is cheaper and helps search and small screens too. The second keeps
the world whole. Both are more than an audit should choose.

One thing is unambiguous and small enough to name separately: the canvas
carries no `role` and no `aria-label`, so nothing announces that a field is
there. Even before either design lands, saying *what* the region is costs one
attribute.

## Still unmeasured

- **An actual screen reader.** This measures accessible names and focus
  visibility, which is what a reader reads — it does not run one. NVDA or
  VoiceOver on the door and the world would say whether the order and the
  phrasing make sense out loud, which no automated check can.
- **The room and agent walls**, and the settings sheets, which have their own
  focus traps.
- **Keyboard escape routes.** Whether every modal returns focus where it came
  from was not asked here.
