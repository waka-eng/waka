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

### Closed, 2026-08-27 — the second form

**The reach.** Standing in the ground, one tab stop carries the whole field: a
`listbox` with `aria-activedescendant` naming the cursor, arrow keys moving
along it, `Home` and `End` at the ends, and `Enter` toggling the memory in
hand. It is drawn nowhere — it wears `.sr-only` — because what a sighted
person sees when it takes focus is the orb lighting up out in the field.

The first form was the cheaper one and it was not chosen. A list of saves
beside the world is the shape this product spent its whole evolution retiring;
`docs/pr-draft.md` (since removed) opened by saying WAKA is "not a list of saves, but a world
you move through". Putting one back for the keyboard would have made that true
for people with a mouse and false for everyone else.

**Arrows select, they do not merely move.** An arrow runs the same `select` a
tap runs — the orb lights, the companion leans, the card opens beside it.
A cursor that moved without lighting anything would leave a sighted keyboard
user pressing keys at a world that does not react, which is the exact quiet
corner this family of work exists to close. Light is the only meaning channel,
so the focus indicator for a memory is the memory.

Measured, live:

```
  opening one to read it:          works
  the ground answers to:           listbox — "Your ground — arrow keys read
                                    through your memories, Enter opens and
                                    closes the one in hand"
  arrows move along it:            yes
```

`memoryOpened` is now a **ratchet** rather than a report, together with two
new ones the earlier version could not have held: the ground must be *named*,
and its cursor must *move*. One lucky Enter on anything satisfies "a memory
opened"; a route nobody can describe or move along is a door with one thing
behind it. All three were verified by breaking them — the reach removed, its
label removed, its cursor frozen — and each failure named itself correctly.

**What it costs at scale: nothing measurable.** The reach renders one
`role="option"` per memory in the ground, which at the field's ceiling is two
thousand DOM nodes beside a canvas that exists precisely so a field of
thousands is not thousands of elements. `e2e:at-scale` now samples frames down
in the ground as well as at the wall: **60 fps at twelve memories and 60 fps at
two and a half thousand**, with 2,000 reachable. No windowing was needed, and
the measurement is kept rather than the assumption.

**One bug found on the way, and it was mine.** The cursor first followed the
world's selection through an effect, so tapping an orb and then tabbing in
carried on from the memory already open. It also let the world overwrite the
cursor: the world releases and re-selects for its own reasons — a travel, a
wind of the dial, an orb leaving the ground — and the cursor jumped back under
the arrows, intermittently. It surfaced as a test that failed three times and
then passed, which is the worst version of an input bug: it works while you
are watching it. The handoff happens once now, on focus, and nothing moves the
cursor afterwards except the person moving it.

**Still open, and smaller than it was:** the canvas itself still takes no
focus. That is now the answer rather than the question — the ground is reached
through the listbox, which is the thing a reader can be told about.

### And the two questions this walk had listed as unasked

**Travelling with keys kept losing your place, and that was a real defect.**
`philosophies & values` and the count under the door are not dialogs; they are
*ways*. Each exists only in the place you left, so pressing Enter on one
unmounts it on arrival and the browser drops focus to the document. Nothing on
screen shows this. A person using a pointer never notices. A person using the
keyboard arrives in the sky, presses Tab, and starts again from the very top of
the page having lost every stop they walked through — on every journey, in a
product whose whole shape is travel.

Fixed: a place that has just been arrived in takes the focus that its own way
in dropped, and only when focus was actually lost, so somebody typing in the
mouth or reading a card keeps it. The sky hands it to the one way back down;
the ground hands it to the ground itself, whose label says where you are and
which keys read it — not to the way back up, because you came down to be among
your memories and the first thing Tab offers should not be the exit.

The first paint is deliberately not an arrival. Without that, opening WAKA
would hand focus to the door, so a fresh visit's first Tab would start two
thirds of the way down the chrome — and the world would have moved something
before the person touched anything. Nothing is dropped on first paint because
nothing was held.

```
  a sheet closed with Escape hands focus back: yes
  travelling with keys keeps your place:
    yes   .jar-values   arrives with focus on jar-up
    yes   .jar-saved    arrives with focus on sr-only
```

**All three grounds answer, not just your own.** The reach reads three
different sources — your archive, an agent's own captures, a room's field of its
members' public memories — and only the first had ever been walked, which is the
shape of a keyboard path that works in the demo. The walk now makes a room and
publishes memories into it, makes an agent and gives it captures of its own
(an agent's wall is built from the agent's OWN memories and never from its
owner's), then travels to each **with keys only** — the way to another wall is a
real button opening a real menu of real buttons, so the whole journey is
tab-and-Enter — descends, and presses the key the ground's label names:

```
  the two grounds that are not your own, travelled to with keys only:
    a room    reached: yes   memories the keyboard can see:   4   one opens: yes
    an agent  reached: yes   memories the keyboard can see:   3   one opens: yes
```

Both are ratchets. A fix that lands on one of three sources is the same defect
wearing a smaller coat.

**Two instrument failures, both mine, both found by the instrument going red on
working code:**

- The probe called `.jar-values` a *sheet* and reported it as a modal that
  fails to restore focus. Wrong about the mechanism, right that it was broken —
  and a report that misnames the mechanism sends whoever reads it to the wrong
  file. Sheets and ways are measured separately now.
- The memory probe is a blind walk that presses Enter on everything it can
  reach. The moment the ground started taking focus on arrival, that walk
  pressed Enter on the way back **up** first, then spent its remaining
  twenty-five rounds hunting for a memory on a wall that has none — and
  reported "the archive is write-only again" against a ground that worked
  perfectly. It has a leash now: each round checks it is still standing in the
  ground and walks back down if it is not.

The blind walk also gained a companion that is not blind: before it runs, the
probe presses whatever the ground's own label says to press. A route only a
blind walk can find is a route nobody is told about, and that half is what
makes the label a promise rather than a description.

## Still unmeasured

- **An actual screen reader**, unchanged from above: this measures accessible
  names and focus visibility, not how they sound in order.
- **A screen reader's actual ORDER.** All three grounds are walked and named,
  but "named" is not "reads well aloud in sequence".
- **The settings sheets' own focus traps** — whether Tab can leave a sheet
  while it is open, which is a different question from whether Escape returns.

## Still unmeasured, as of the original walk

- **An actual screen reader.** This measures accessible names and focus
  visibility, which is what a reader reads — it does not run one. NVDA or
  VoiceOver on the door and the world would say whether the order and the
  phrasing make sense out loud, which no automated check can.
- **The room and agent walls**, and the settings sheets, which have their own
  focus traps. *(All three grounds and the sheets' escape were measured on
  2026-08-27 — see above. Whether Tab can LEAVE an open sheet is still not
  asked, which is a different question from whether Escape returns.)*
- **Keyboard escape routes.** Whether every modal returns focus where it came
  from was not asked here. *(Asked on 2026-08-27; it found a real defect in
  travel rather than in sheets.)*
