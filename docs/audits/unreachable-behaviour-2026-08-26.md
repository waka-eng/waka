# Wired, compiled, and unreachable — three designed behaviours nobody can see

**Date:** 2026-08-26
**Found by:** following the clock bug in `docs/audits/first-run-2026-08-26.md`
**Status:** reported, not changed — each is a founder call, for reasons below.
The class is now gated: `packages/web/test/wall-chrome.test.ts`.

## Why these escaped every dead-code gate

`orphans.test.ts` finds unreachable modules and uncalled exports. `dead-css.ts`
asks the browser which rule won each property. Neither can see the shape here,
which is a third thing:

> code that is imported, called, wired into state, compared on every render —
> and whose output never reaches a person.

Every gate this repo has answers "is this called?". None answers "does anything
come of it?".

## 1. The forming line is computed twice per render and rendered nowhere

`formingWords()` in `space/top-of-mind/board.ts` produces the sentence under
the poster that says something is happening beneath it — *"One signal is
forming"*, or *"A new ambition is forming"* when a proposal outranks the
readings. Its doc comment states a real product rule:

> *"provisional top-of-mind notes are counted, never listed, and never as a
> digit."*

It is called in both chrome derivations, stored as `WallChrome.forming`, and
compared for equality in `applyChrome`'s memo on every render.

**No JSX reads it.** Traced with comments stripped: `forming` is written in
five places, compared in one, and the only fields any element renders are
`c.formingAlt` and the literal fallback `"Forming — nothing adopted yet"`.
There is no `{...c}` spread anywhere that could pass it down.

Confirmed in a browser: with an emerging signal on the server, no element
matching `[class*=jar-forming]` carries a forming line, before or after a
reload.

`jar-forming-line` exists as a class but is worn only by
`jar-forming-line--choose`, which belongs to a different flow.

**Why this is not mine to fix.** Deleting removes a designed piece of the
product's voice; rendering it adds a line to the world's most sacred surface.
Both are decisions about what the poster says, which is the founder's.

## 2. The companion's rising motes cannot appear

```js
const forming = false; /* nothing forms overhead since the sky went */
if (forming) { … }
```

Twenty lines gated on a literal `false`, left when the sky engine was deleted
on 2026-08-25. Inside it is the only code that ever sets `riseA[i] > 0`.

So the two other halves of that animation are dead by consequence:

- the integrator (`riseY[i] -= dt * 58; riseA[i] -= dt * 0.26`) — every
  iteration hits `if (riseA[i] <= 0) continue` first
- the draw (`ctx.drawImage(pal.mote, …)`) — same guard, same result

`companion.glanceAt` is **not** in this set: it is also written when the
companion is tapped, and stays live. `companion.riseAt` is written only here.

**Why this is not mine to delete.** `const forming = false` with an
explanation beside it is *parked*, not abandoned — somebody chose to disable
rather than remove, which reads as an intention to bring it back. Whether the
sky returns is a founder call, and deleting the motes forecloses it quietly.

### The trap in fixing it, recorded for whoever does

The `else` branch runs every frame:

```js
} else {
  companion.glanceUntil = 0;
}
```

Deleting the `if`/`else` pair as one dead block would remove a live
per-frame assignment. The dead half is the `if` body only.

## 3. A third field, and a near-miss worth more than the finding

`WallChrome.eyebrow` is written in five places — including `eyebrow: name` for
rooms and agents — compared in the memo, and **never read**. The JSX writes
the words literally:

```jsx
<div className="jar-eyebrow jar-label">top of mind</div>
```

Measured: standing in a room called *"the reading room 39066"*, the
headquarters eyebrow reads `top of mind`. The field's own doc comment said:

> *"the wall's name, and nothing else in that slot, ever"*

So: a documented contract, a render that ignores it, and a browser
confirming the room's name is missing from a slot that promises to hold it.
Three independent signals pointing at a bug, and a one-line fix ready to
write.

The comment immediately above the JSX says:

> *(founder, 2026-08-25: "this should always say TOP OF MIND at the top no
> matter what room")*

The render is **right**. The name is already on screen twice — in the pill at
the top left and on the axis below — so the slot was spending itself on
repetition. What was wrong was the field's contract, which still described the
world before the ruling.

**A stale contract is worse than no contract**: it makes correct code look
broken and invites exactly the repair that undoes a decision. The comment on
`WallChrome.eyebrow` now records the ruling instead of contradicting it. The
render is untouched.

This is the second time in two audits that a finding dissolved on reading the
line above it — the mouth's placeholder was the first. Both times the code was
right and the surrounding prose was what needed fixing.

## 4. What this says about the gates

Both of these would pass every check in the repo today, and both are the same
shape as findings the last two audits produced by other means:

| audit | the shape it found |
| --- | --- |
| failure paths | a handler that runs and says nothing |
| first run | a fetch that lands and shows nothing |
| this one | a value that is computed and displays nothing |

**It is built now** — `packages/web/test/wall-chrome.test.ts`, three
assertions, no browser, in `pnpm -r test`:

- every field of `WallChrome` is read through a render binding (`c.field`,
  `c?.field`), or is listed in `DARK_BY_DECISION` with the ruling that made it
  dark and where that ruling is written down;
- nothing listed as deliberately dark is being drawn after all — an excuse
  that has quietly become wrong is a gate lying in the reassuring direction;
- the parser can still find the interface, so a silent zero-field sweep can
  never report a clean bill.

Deliberately *not* "the field appears anywhere": `prev.forming === next.forming`
in the memo's equality check is a read, and counting it would have let the
exact bug this gate exists for walk straight through.

Sabotaged four ways before being trusted: removing the only `c?.empty` read
(caught), rendering a parked field (caught), renaming the interface outright
(caught), and renaming it to `WallChromeX` — which **passed**, because
`indexOf` has no word boundary and the prefix still matched. The floor was
testing something narrower than it claimed. Fixed, re-sabotaged, caught.
