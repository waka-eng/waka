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

*(An earlier draft of this law also cited "why red" as colour used
decoratively. The full-transcript audit traced that message and it was about a
red row in Claude Code's own background-agent list — a batch killed by a
session limit — not about anything in the product. There is no red in
`claims.css`, `chat.css` or `home.css`. The quote is removed rather than
reinterpreted: a law argued from evidence has to drop the evidence that turns
out not to be evidence, or the law is just an assertion with decoration.)*

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

## Law 7 — A ruling is applied to the class, not the instance it was pointed at

> *"all of it should say 'You're' in front. Make sure that like everything has
> the first character of the word capitalized."* → applied to eight rows; 141
> lowercase strings still rendered.
> *"make it a single paragraph, don't split it into separate sentences."* →
> applied to the switcher; the MCP hover card is still three spans.
> *"All buttons should be a single line. Never make it into a two line thing."*
> → fixed on the control being pointed at; never verified anywhere else.

This is **not** Law 3, and the difference is worth holding. Law 3 is one
*change* that failed to reach other screens. This is a *general rule*, stated
in general words, applied only where the founder's finger happened to be.

The tell is that the founder says "all", "everything", "never" — and the fix
touches the one instance in the screenshot. They then have to restate the same
rule on the next screen, which reads to them like being ignored, because it is.

**The test:** when a ruling is stated as a rule, enumerate everything its own
words cover — every string, every control of that kind — and fix them in that
commit. If the set is large, that is a reason to write a gate, not a reason to
do one.

---

## Law 8 — A control's handler must be reachable, and a test must press it

> The one-press return to the top of mind rendered, read "Your top of mind",
> was enabled, and did nothing: it found its destination with
> `items.find(i => i.id.endsWith("top-of-mind"))` and the rows had been
> renamed to `me` / `agent:<id>`. `find` returned `undefined`.

A dead press is worse than a missing control. A missing control reads as a
thing not offered; a dead one reads as the product being broken. And nothing
catches it — it type-checks, it renders, and the suites that covered that bar
asserted the control's *text*, which is true of a dead button.

This shape has now appeared repeatedly here: `pointer-events` inheritance
three times, an interactivity check missing `[role="button"]`, a scrim losing
on source order, and an optional `onOpen?.()` with no default. Every one
rendered perfectly and did nothing.

> *an exit must not be computed from where you are standing, because the state
> it rescues you from is a state you are standing in.*

**The test:** a new control gets a test that **presses it and asserts the
effect** — never that it is on screen. Prefer structure over lookup: a visible
close on an overlay cannot go stale, because there is no destination to
resolve.

---

## Law 9 — A feature the founder cannot exercise is not shipped

> Photo moments: `ATTACHMENTS_BUCKET` is unset locally, so uploads 500 on the
> only machine they use. They asked for it and have never seen it work.
> Google sign-in: the redirect URI was never added, so the door does not open.

Local-dev configuration is part of the deliverable. "It works in principle" is
not a state this product recognises anywhere else — it is the same honesty the
empty states are held to.

**The test:** before calling a feature done, exercise it the way the founder
would, on their machine. If that is impossible, say so in the same sentence
that reports it built.

---

## Law 10 — An answer collected is an answer read

An input the product collects and then ignores is worse than one it never
offered: it spends a person's attention and returns nothing, invisibly, so
nobody can tell it is happening.

**This law has no confirmed violation in the product, and the story of its
candidate is the useful part.**

The full-transcript audit reported one: `"partly"`, the middle answer to "is
this true of you?", was said to be written to the database, fenced into
prompts, asserted in six test files — *and read by nothing*, because
`top-of-mind-synthesis` compares `=== "true"`. A third of the answers the
confirmation loop was built around, changing nothing.

That reading was wrong, and checking it is why it is written up here rather
than fixed. `recentFeedback()` passes **every** verdict value, `partly`
included, into the generation payload beside the statement it was given about;
the prompt then says what to do with it — *"A verdict of partly is an
invitation to sharpen, not to repeat."* So it is read, by the only reader that
could act on it. What it does **not** do is move the selection arithmetic, and
that is deliberate, stated in three separate places: *"a `partly` verdict
resolves nothing — it is an invitation to sharpen, not an arbitration."*

Two things worth keeping from the near-miss:

- **"Read" includes "read by the prompt."** An audit that greps for an input
  in scoring and ranking code will call every soft signal dead. The generator
  is a consumer.
- **A documented non-effect is not a bug.** `partly` is designed to refuse to
  arbitrate. The test for this law is "name the code that reads it", and the
  answer may legitimately be "the prompt, which is instructed to sharpen" —
  it may not be silence.

**The test:** for every input the product collects, name the code that reads
it. If there is none, either wire it or stop asking. If there is one and it
deliberately changes no number, say so where someone auditing will look.

---

## Law 11 — Under a statement about the person, the controls answer it; they never administer it

> "Just changing the text and removing duplicate is not enough. Just rethink
> the full interaction here. When the user looks at this top of mind, what
> would they want to do? How would they want to do that interaction? This is
> definitely not the right way." — 2026-10-11

This is the law that none of the ten above catches, which is why it took a
second complaint about the same block to find it. Law 1 asks whether a control
names what it does; all four of these did. Law 4 asks whether it prints
something already known; none of them did. They were each individually
defensible and collectively wrong, because the question was never "is this
verb correct" — it was "is a verb what belongs here at all."

**The test.** When a surface shows a sentence claiming to describe a person,
read the controls under it and ask which side they are on:

  RESPONSE — yes, not quite, not me, that matters more to me, here is what
  is closer. These are the person speaking back about themselves.

  ADMINISTRATION — regenerate, pin, reorder, rename, edit, discard. These are
  the person doing upkeep on an object.

A surface may offer administration. It may never offer ONLY administration,
and administration may never sit in the same row, register and rhythm as the
answers — because then the person has to work out which of five things is the
reply to the question they are already silently asking.

**Why this one is expensive to get wrong.** The reaction to a sentence about
yourself is involuntary and immediate. If there is nowhere to put it in the
second it happens, it is gone, and the product has turned the most alive
moment it will ever get into a filing task. That is also why the answer row
cannot hide behind a gesture nobody has reason to make: the question itself
must be visible at rest, even when the answers are not.

**Where it was broken, and what each one became.**

| surface | had | now |
|---|---|---|
| top of mind (home) | `Write a new one` · `Keep on top` · `Edit wording` · `Not this` — four administrations, no answer | `Is this you?` → **Yes · Not quite · Not me**; the administrations moved to a quiet aside beside the staleness line they remedy |
| principles | `Move up` / `Move down` — the ranking act, labelled as list mechanics. The i18n keys were `worldMattersMore` / `worldMattersLess`, so the code knew what it meant and the person was told where the row would go | **Matters more to me** / **Matters less to me** — the key's own meaning, said out loud |
| the creature's claim | — | nothing. It was already right, and it is where the answer came from |

**The model is in the product, not in this document.** `jar-char-claim-answers`
is the register: a question, three peer answers, no primary, and one of them
opens a field to say what is closer. Any new surface that shows a person a
sentence about themselves wears it. When the top of mind did not, the home
screen carried two sentences about the same person asking for the same thing
in two different languages — which is Law 5 as well, arriving by a different
road.

## How to use this

Before shipping a surface, walk the six. The laws are ordered by how often
they have been broken, so the first two catch most of it.

When a new complaint arrives, **find its law first** — then fix it everywhere
that law applies, in that commit. Fixing it on the reported screen alone is
what produced this document.
