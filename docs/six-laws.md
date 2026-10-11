# Six laws, derived from what the founder actually said

Every design complaint in this product's history has been one of six things.
This document exists because the complaints kept arriving **one screen at a
time**, and each was fixed on the screen it arrived on — so the same law was
broken on four other screens nobody had looked at yet, and the next complaint
was inevitable.

Founder, on exactly this: *"really synthesize everything I told you to find
what else you should fix so that I don't feel this way for other parts of the
experience that I haven't pointed out yet."*

So each law below carries the quotes it was derived from, and — the part that
matters — **where it is probably still broken**. A law with no "where else" is
a law that has not been taken seriously.

---

## Law 1 — A control names exactly what it does, and does exactly what it names

> *"I didn't realise clicking on top of mind would leave me there."*
> *"make settings look like settings"* (pointing at a cog that didn't)
> *"this also is so useless"* (the "Close menu" row)
> *"rather than keep, say save inspiration for the button"*
> *"so many different buttons that I have no idea what its supposed to do"*
> *"why red"*

Five separate reports, one law. "Top of mind" changed the surface **and** the
owner, so it did more than it said. "Keep" was a verb that didn't name the
act. "Close menu" named an act nobody wanted. The chat console's controls
named plumbing. Red meant nothing, so colour was doing decoration.

**The test:** cover the screen and read the label aloud. If a person cannot
predict what happens, or if something *else* also happens, the control is
lying.

**Where else to look:** every icon-only control; every control with a side
effect beyond its label; every place colour or weight carries meaning that
isn't stated.

---

## Law 2 — Every surface you can enter has a visible way out, and it costs one press

> *"after I click on it, I feel like I'm lost how to go back to the previous screen"*
> *"I go to my agent and then now I have no way to get back to my top of mind"*
> *"I find it so annoying that from talk with Waka, there's no one click to go back to top of mind"*

This is the most-reported law and the one with the most surface area left.
Note what did **not** fix it: the archive had a URL, a working browser Back,
and a switcher that named it. It still felt like a trap, because reaching it
**unmounted the world** — and once the world is gone there is nothing to
return *to*, only somewhere else to navigate.

**The test:** on every surface, is there a visible control that goes back
where you came from, in one press, without choosing a destination from a
list? A list is not an exit. Browser Back is not an exit. Knowing Escape
works is not an exit.

**Where else to look:** `/days`, `/profile`, `/onboarding`, the public
profile page, the review surface, the principle-share surface, the room
form, the seek/find surface — **and every `DialogSurface` in the codebase.**

---

## Law 3 — A change to the system lands on every surface, not the one being looked at

> *"why this screen so different? it should get the full changes from [the other screen]"*
> *"these 3 things should be same text size font color etc."*
> *"help me clean up this aesthetic so it's more simple and clean UI"*

The mechanism of this failure is known and documented: `claims.css` and
`chat.css` were not in the type-scale gate's `GOVERNED` list, so two parallel
design systems grew (type tokens vs raw px, `--sp-N` vs `--space-N`) and
neither gate noticed. The same shape recurred in logic: controls gated on
`atWall.kind !== 'self'` only ever rendered on walls nobody audited, so every
home-screen ruling missed them.

**The test:** when a ruling is made, grep for every call site of the thing it
governs — not every call site *on this screen*.

**Where else to look:** any stylesheet not in `GOVERNED`; any component
rendered only in a state the founder has not happened to open.

---

## Law 4 — Don't print what the person can already see or already knows

> *"remove things not 100% necessary"* (pointing at "Enter to keep")
> *"so crowded!"*
> *"make it a single paragraph, don't split it into separate sentences"*

Founder law already on the books: *states render, numerals never.* "Enter to
keep" explains a convention the box already implies. A page heading that
repeats the switcher above it names the surface twice. A three-clause list
reads as a specification to memorise when the question was only "what is
this".

**Where else to look:** placeholders that restate their label; `aria-label`s
that duplicate visible text; empty states that explain the obvious; field
hints on the settings page; every count and every number on screen.

---

## Law 5 — The product is one material, and every surface wears it

> *"Speech bubble doesn't match the grainy texture of the character and the product"*
> *"why this screen so different?"*
> *"and talk about this rather than put it in a button"*

The grain, the near-black ground, the Jost ladder, the single meaning channel
(light). A surface that doesn't wear these reads as another app, and the
founder notices immediately and every time.

**Where else to look:** `Login`, `Onboarding`, `PublicProfile`, `Days`,
`Profile` — none of these has been through a craft pass. Also every surface
built after the grain landed, which must *opt in* rather than inherit.

---

## Law 6 — Nothing moves unless the user moved it, and nothing is measured once

> *"the page just feels unbalanced to my eyes"*
> *"the bottom of the page still has the old floating circles, I can see it float up and down once in a while"*

The sag had one cause: a `ResizeObserver` that didn't watch the async voice
block, so the layout was *measured once*, which is the same as hard-coded.
The circles were motion nobody asked for.

**The test:** every measurement feeding layout is observed, not sampled. Every
animation answers "what did the user just do?"

**Where else to look:** every `offsetHeight` / `getBoundingClientRect` read
that is not inside an observer; every mount-time animation.

---

## How to use this

Before shipping a surface, walk the six. The laws are ordered by how often
they have been broken, so the first two catch most of it.

When a new complaint arrives, **find its law first** — then fix it everywhere
that law applies, in that commit. Fixing it on the reported screen alone is
what produced this document.
