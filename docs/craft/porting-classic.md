# Bringing the rest onto the surface — and making it better

Status: 2026-08-03. `/classic` still routes; it comes out when §1 is done.

## Already deleted

- The legacy US-051 conversation-rooms surface (`SHOW_LEGACY_GROUP_ROOM_SURFACE`
  was `false` — dead in the running app), 39 lines plus its state.
- `.memory-window-*` — the draggable floating window, a third way to look at a
  save stacked on top of two others. 71 lines of CSS.
- Memory groups and the drawer's grouping UI, superseded by ask-don't-browse.

---

## 1. What has to be ported, and how it changes

The rule: **nothing arrives as a panel.** Every capability below becomes
either a state of the surface or a gesture on an object already on it. If
something can only be expressed as a new screen, that is a sign it has not
been designed yet.

### The reading is the object, so its verbs live on it

Four capabilities in classic are separate controls in a row under each note —
correct, pin, take down, discuss. On the surface they belong to **the reading
you have open**, not to a card in a grid, because the opened reading is
already the screen that says "this is the claim and here is what it rests on".
That is the only place where correcting it is an informed act.

| classic | on the surface |
|---|---|
| inline `<textarea>` on the post-it + autosave | the claim itself becomes editable **in the reading state**. Click the sentence, rewrite it, blur to save. The wall shows your words afterwards. |
| trash icon → 4.2s undo toast | **take it down** as a quiet verb beside the claim. The wall re-forms without it; undo lives on the verbs line for the same 4.2s. |
| pin icon | **hold** — same row. A held reading survives a pass that would have retired it. |
| "re-read this room" button | folded into the room's own name: the headline under it already says *3 readings held · last read 2h ago*, and "last read 2h ago" is the affordance. |

*Why not on the post-it:* six icon buttons on a sheet is what the old wall
did, and it is why the sentence was never the loudest thing on it. The wall
stays a wall of sentences; the verbs are one level in.

### A save's verbs live on the save

Edit text, delete, delete a reflection. Same argument: they belong in the
save-reached-by-looking state, at the foot, after everything — content before
actions, destructive last.

### Rooms

This is the biggest gap: the surface can list and switch rooms but not
**make** one or **get into** one.

The rooms state is currently a list of names at display size. It becomes the
place where a room is a thing you do something with:

- **making one** is a line at the bottom of that list — type a name, it is
  the newest name in the list.
- **joining** is the same field: paste a code or a link into it. One field,
  because "which of these am I doing" is a question the product can answer
  itself from what you typed.
- **the invite code** appears under the room's name when it is the active one.
- **rename / leave / remove someone** live under the cast, not in a settings
  panel — the faces are already the roster, so the actions belong to them.
- **join-by-URL confirmation stays a real moment.** A link must never put your
  saves into someone else's pool; this is the one place ceremony is correct.

### Capture, properly

The surface's capture is a textarea and `createInspiration({ text })`.
Classic's cell also handles attachments, links, selected-text sparks,
resonance and a reflect-during-capture flow.

Port **files, links and the reflect step**. Drop resonance-at-capture: it asks
you to rate something at the moment the product's own principle says never
gatekeep a save.

### `recordRevisit` — the invisible one

Eleven call sites in classic, none on the surface. It feeds the revisit signal
the scoring uses, so dropping it degrades the *algorithm* while nothing
visibly breaks. Port first, precisely because nothing will tell us if we don't.

### Also

`createFeedback` on a reading; `fetchTopOfMind` / `refreshTopOfMind` for the
solo wall; language controls and the profile link — both belong wherever
"everything else" currently is, which becomes the only chrome on the page.

---

## 2. Where the design is still weak

Honest read of what is on screen now.

**The bottom is a control panel.** A timeline row and a verbs row, stacked,
occupying a fifth of the screen and containing the least considered pixels in
the product. Two utility bars under a wall is what a dashboard looks like.

**The wall has no composition.** Notes flow left-to-right in grid order. A
real wall clusters — things near each other are about each other. Positions do
not persist, so moving a note is a gesture with no consequence, and the
promise that "the machine proposes and you arrange" is not visible anywhere.

**Nothing on the surface is alive.** Nothing changes unless you click. There
is no sense that saves are landing, that a pass is due, that the room is
doing anything between visits.

**The head is thin.** A name, a count, and some faces. Nothing says what this
room is *about* — which is the one thing a room has.

**One accent, used once.** `--mark` appears on a marked span and nowhere else,
so most screens have no colour at all doing any work.

---

## 3. Ideas worth trying

Roughly ordered by how much they would change the feel per unit of work.

### A — Give the wall the whole window

Delete both bottom rows. Verbs become one line that fades in at the bottom
edge on approach, or `⌘K`. The timeline becomes a horizontal drag **on the
wall itself** — grab the background and pull right to go back in time, which
is the same gesture as pulling a stack of paper aside. The wall gets the
screen; the instruments appear when reached for.

### B — Cluster instead of grid

Lay notes out by **how much evidence they share**. Readings built on the same
saves sit near each other; unrelated ones sit apart. Proximity becomes
meaning, the wall becomes readable at a glance before you read a word, and it
is the visual form of the thing the product is actually claiming. Persist
positions after that, so your arrangement survives — which finally makes drag
worth having.

### C — The un-read edge

Saves that have landed but not yet been read, along one margin, in the same
paper unwritten-on. The wall stops being a static result and becomes something
with material waiting in it. Answers *"did you hear me?"*, which today nothing
does. **Needs one API field** — saves since the room's last pass.

### D — Hover a reading, see what fed it

Hovering a post-it dims the others and lights the un-read/evidence saves it
rests on. Provenance without leaving the wall, and it makes the wall feel
wired together rather than tiled.

### E — Rooms as a change of light

Switching rooms keeps the wall in place and changes the papers and the name,
rather than swapping a list. Same material, different hearts reading it.

### F — Let the room say what it is about

Under the name, one line the product writes: *"this room keeps returning to
building things you can touch."* A room's character, in its own voice. It is
also the honest place to say **"only your saves are readable here"** when that
is true — which today the product says by silence.

---

## 4. Order

1. `recordRevisit` — invisible, degrading, cheap.
2. Correct / take down / hold, on the opened reading. Then `/classic` loses
   its last unique trust-critical job.
3. Rooms: make, join, invite, rename, leave.
4. Capture: files, links, reflect step.
5. Delete `/classic` and `Home.tsx`, and with it the superseded blocks of
   `global.css`.
6. Then the ideas in §3, starting with **B** — it is the one that changes what
   the wall *means*, not just how it looks.
