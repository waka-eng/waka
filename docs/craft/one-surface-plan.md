# Getting the running app to the prototype

Status: Phases 0–3 done. Phases 4–7 unverified — the surface was rewritten
rather than migrated phase by phase, so some later phases may be partly or
wholly present without having been checked against their own description.
**Audit before working any of them.** Last reviewed 2026-08-05. Prototype:
`claude.ai/code/artifact/a2a67c87-75df-4c11-a127-17997745549b`

> One known regression, recorded 2026-08-05: Phase 2's `body:has(...)` stopgap
> survives in `system.css:458-459`, but it selects `.nc-stage--top-of-mind-wall`,
> `.memory-contents-item--expanded` and `.reference-capture-modal` — classes
> belonging to the deleted UI. It therefore matches nothing on the Surface, so
> the wall no longer recedes-and-dims behind an open reading; it is replaced.
> That is the opposite of what the phase was for.

## Why localhost looked nothing like it

The prototype is a different composition, not a restyle. Porting the *system*
— type, colour, motion — into the existing page changed how it sounds and left
its shape untouched. The shape is the gap, and it is measurable:

- **26 `position: fixed` rules**, z-indexes reaching **1000**.
- **Five overlay layers** that can each cover the wall: the 460px history
  panel, a draggable memory-window layer, the capture modal, the room panel,
  the drop overlay.
- **A three-blob animated colour wash plus a grain overlay** behind everything,
  inherited from the original `index.html`. Text sits on a moving, unevenly
  tinted field, so nothing has a stable contrast relationship with its
  background. This is why every screenshot reads as foggy regardless of what
  is drawn on it.

The prototype has **one surface and no overlays at all.**

## The one thing everything else follows from

`homeMode` (`Home.tsx:1867`) is already a state machine — `"topOfMind" |
"memoryDrawer"`. The prototype needs the same machine with more states, and
every overlay's own open/closed boolean folded into it:

```
wall · reading · save · capture · ask · rooms · time
```

Once state is single, "the wall recedes and the thing comes forward" is one
class on one container, and the five overlays stop existing.

## Phases

Each is separately visible, and each can be judged before the next.

### Phase 0 — Flatten the ground ✅ done
Blobs and grain off; flat parchment. The single biggest reason the running app
and the prototype did not resemble each other.

### Phase 1 — Dissolve the sheets ✅ done
The drawer stops being a 460px floating panel and becomes the same ground at
the same width as the wall. Rows lose their border, radius, fill and hover
fill — four devices to say "this is a row" on a surface where only the words
matter. The draggable memory-window layer is switched off.

### Phase 2 — The wall recedes ✅ done
Opening a save scales the wall back and dims it rather than covering it. You
are still in the room; the readings are still behind what you are reading.

*Currently driven by `body:has(...)`, which is a stopgap — it reads the DOM to
infer state. Phase 3 replaces it with the state machine.*

### Phase 3 — One state machine ✅ done
The state machine landed, and not as an extension of `homeMode` — `Home.tsx`
was deleted outright and `Surface.tsx` written in its place. State is derived
from the URL by `lib/surface-route.ts` (`wall · reading · save · ask · capture
· direction`) and applied as `data-state` on one container
(`Surface.tsx:2213`). Browser Back and Forward restore where a member was,
which the original plan did not ask for.

### Phase 4 — The head that never moves
Room name and cast lift out of `RoomTitle` into the surface's own head, so
they persist across every state and shrink when the surface is busy. This is
what makes it feel like one place — you always know which wall you are at.

### Phase 5 — The verbs
The bottom bar becomes three words on a line. The search field stops living at
the bottom of the screen permanently and becomes the `ask` state.

### Phase 6 — Capture as typing
No modal. Typing on the surface is capture.

### Phase 7 — The un-read edge
Saves that have landed but not yet been read, along the bottom of the wall.
**Needs an API field** (saves since the room's last pass) — not front-end.

## Not in the prototype, still unbuilt

- **Correction.** Needs somewhere to record that a reading was taken down, and
  the next pass has to read it, or the gesture is theatre.
- **Clustering two post-its to name what they share.** Needs a table for a
  user-made grouping and its name, and a synthesis-pass change.

Both are the real work, and both are what would make the product listen.

## Deleting the old layers

Nothing above deletes superseded CSS yet; `system.css` overrides it. Once the
shape is accepted, the superseded blocks in `global.css` come out and
`system.css` becomes the only stylesheet. Doing it in that order keeps the
whole makeover one import away from revert while it is being judged.
