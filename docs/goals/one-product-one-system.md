# Goal: one product, one system

Status: **audit complete, phases open.** Opened 2026-08-25.
Branch: `claude/waka-product-evolution-vbj1ur`.
Supersedes the closing section of `everything-in-the-world.md`.

Founder, 2026-08-25, in one message:

> ensure all workflows have complete e2e and achieved goal without breaking in
> the middle. also conduct extensive audit and design to migrate everything in
> flat wall to world and deprecate all flat screen related stuff … do audit of
> all components so nothing that serves the same purpose renders sth on its
> own. reuse components as much as possible and delete the ones not being
> used … it should be so standardized and consistent that we can build a
> design system out of it. also audit this entire product for using it on
> mobile … ensure font and text style used is also consistent and feel like we
> built it from an official design system instead of using random font and
> sizes and spacing here and there.

## The decision this reverses

`everything-in-the-world.md` closes with:

> **Deleting the flat routes.** They are the parking lot and they stay
> addressable. If they ever go, that is a separate decision made after nothing
> needs them.

That separate decision has now been made, and it is made in the other
direction: the flat routes go. This document does not pretend the earlier one
said something else — it records the reversal, keeps the earlier reasoning
legible, and inherits its bar for what "in the world" means:

> the feature is reachable and usable from `/` without visiting a flat route,
> and that was seen in a browser rather than reasoned about.

That bar is unchanged and every phase below is measured against it. What
changes is the consequence of clearing it: previously the route stayed as a
parking space, now the route is deleted.

**Order matters and is not negotiable.** Nothing is deleted before its
replacement has been seen working in a browser. A flat route whose world
answer does not exist yet keeps working until it does. The failure this
prevents is a person losing the only way to do something because the
replacement was "designed" rather than built.

---

## What was measured

Everything in this section is a count taken from the tree at the commit that
opens this goal, not a recollection.

### 1. The world cannot do ten things the flat screens can

Method: extract every API verb imported by `pages/Surface.tsx`,
`components/AgentsScreen.tsx` and `components/GraphScreen.tsx`, extract the
same for `pages/Home.tsx`, and diff. Then confirm each survivor by name
against `Home.tsx` directly, because an import diff alone would report a
verb the world spells differently as a gap.

| verb | world | flat | what is actually missing |
|---|---|---|---|
| `declarePrinciple` | 0 | 2 | you can read your principles in the world and cannot write one |
| `updatePrinciple` | 0 | 2 | …or change its words |
| `deletePrinciple` | 0 | 2 | …or take it back |
| `disputePrinciple` | 0 | 2 | …or contest one |
| `reorderPrinciples` | 0 | 2 | …or say which matters more |
| `updateSignal` | 0 | 2 | a pattern's sentence cannot be edited in the world |
| `deleteSignal` | 0 | 2 | a pattern can be dismissed in the world but not deleted |
| `updateTopOfMindEntry` | 0 | 2 | the board's own entries cannot be edited |
| `refreshGroupTopOfMind` | 0 | 2 | a room's board cannot be asked to re-synthesise |
| `createAgentKey` / `fetchAgentKeys` / `revokeAgentKey` | 0 | 2 | an agent's credentials have no address in the world at all |

Plus one whole surface with no world answer: **the stack graph**
(`GraphScreen.tsx`, `/graph`, `/graph/:profileId`).

Everything else the flat screens import is either the flat router itself
(`parseSurfacePath`, `buildSurfacePath`), the flat locale helpers
(`formatMessage`, `readStoredLocale` — the world uses `t`), or a read the
world already performs through `lib/data.ts` under another name
(`fetchInspiration`, `fetchSignal`, `fetchSignals`, `fetchTopOfMind`). Those
are not gaps and no phase below spends effort on them.

**So the migration is nine routes of which seven are already covered.** The
real work is principles-as-a-writable-thing, signal and board editing, agent
credentials, and the graph.

### 2. There is no design system; there are four naming systems

| stylesheet | lines | top-level class rules | prefixes |
|---|---|---|---|
| `home.css` | 3,171 | 298 | `jar-` |
| `surface.css` | 2,093 | 270 | `sf-`, `gr-`, `pr-` |
| `global.css` | 2,348 | 214 | `nc-`, `profile-`, `login-`, `btn-` |
| `chrome.css` | 1,191 | 135 | `profile-`, `login-`, `field-`, `auth-`, `btn-` |
| `system.css` | 504 | — | token declarations |
| `layers.css` | 58 | — | layer order |
| **total** | **9,365** | **917** | **six prefixes** |

`btn-` is declared in `global.css` (13 rules) and again in `chrome.css` (6).
`profile-` is declared in both. The same concept — a button, a field, a panel,
a list row, a label — is implemented separately under each prefix, and no
primitive is shared across any two of them.

**Three parallel token sets already exist and none of them is authoritative:**

- `--jar-*` — `home.css` (32 declarations) and `system.css`
- `--sf-*` — `surface.css` (44 declarations)
- `--t-*` — `global.css` (33) and `system.css` (26)

### 3. The type and space scales are not scales

Distinct values in use across the six stylesheets:

| property | distinct values |
|---|---|
| `font-size` | **53** |
| `line-height` | 29 |
| `border-radius` | 23 |
| `letter-spacing` | 20 |
| `font-family` | 17 |
| `font-weight` | 7 |
| spacing (`padding`/`margin`/`gap`/inset px literals) | **47** |

Among the font sizes: `6.5px`, `7.5px`, `8.5px`, `10.5px`, `12.5px`,
`13.5px`, `14.5px`. Seven half-pixel sizes is not a scale anyone chose; it is
what happens when a size is nudged at the call site until it looks right.
Eight of the fifty-three are token references and forty-five are literals.

A design system cannot be "built out of" this by naming what is there. The
scale has to be **declared first and the call sites moved onto it**, which is
the shape of Phase 3.

### 4. The e2e suites do not all pass

Full sweep of the twelve named suites, run against a live stack while this
audit was written. Results are recorded in the phase that fixes them rather
than summarised here, because a list of red suites with no owner is what this
goal exists to stop producing.

Known at time of writing: `e2e:first-paint` case 1 fails —
`the world renders with every third-party host unreachable — path=/login
rootChildren=1 canvases=0 text=156`. The remaining suites were still running.

### 5. Mobile is unmeasured

`everything-in-the-world.md` Phase 5 fixed touch targets on the **flat**
routes and gated them at 390px. The **world** has never been walked at a phone
viewport by any gate in this repo. `e2e:measure` runs at 1100×780 and every
capture in this session was 1100×780. Nothing is known about the world on a
phone that was not reasoned about, so Phase 5 measures before it fixes.

---

## The audit register

Founder, 2026-08-25: "give me the list of audits and end state of each audit …
ensure you do all the audits and fix everything to achieve the desired end
state per audits goal."

Six audits. Each one's END STATE is written as something countable, so that
"done" is a measurement rather than an opinion, and each carries the gate that
holds it there. Every "now" figure below was taken from the tree, not
remembered.

### A1 — Every workflow reaches its end

**End state.** Every named suite exits 0 on a cold stack. No suite reports the
product as broken when the truth is a missing capability in the environment;
that case says NOT EXERCISED and says why. No workflow stops halfway.

| | |
|---|---|
| Gate | `pnpm e2e:<name>` for all 14, each exiting 0 |
| At open | 9 of 11 green; 5 red cases, all environmental, reported as product failures |
| **Now** | **14 named suites, all exit 0.** `NotExercised` separates a stack that cannot host a claim from a product that answered wrongly |
| State | **MET** |

### A2 — The flat screens move into the world and are deleted

**End state.** `Surface.tsx`, `surface.css`, `GraphScreen.tsx`,
`AgentsScreen.tsx` and the eleven flat routes are gone from
`packages/web/src`. Nothing in the tree matches the `sf-`/`gr-`/`pr-`
prefixes. Every capability they held is reachable and usable from `/`, seen in
a browser rather than reasoned about — the bar inherited from
`everything-in-the-world.md`, unchanged.

| | |
|---|---|
| Gate | routes absent from `main.tsx`; retired prefixes absent from the tree; a browser walkthrough per capability; all suites still green |
| At open | 4,784 lines across four files; 16 routes; 12 verbs the world cannot do |
| **Now** | **0 left.** 5,034 lines deleted across seven files; `grep -E '"(sf\|gr\|pr)-'` over `packages/web/src` returns **0**; `main.tsx` holds six routes and not one of them is flat. Of the twelve verbs: ten built into the world, one was never missing, one deliberately declined — each accounted for below |
| State | **MET**, 2026-08-26 |

**TWO CORRECTIONS TO THIS AUDIT'S OWN NUMBERS,** found while building against
them and recorded rather than quietly adjusted.

The verb diff was taken over `Home.tsx`'s OWN imports. The world reaches a
good deal of the API through `space/editing.ts` instead, and that file was not
in the diff — so a verb the world can already run looked missing.

- `updateTopOfMindEntry` **was never missing.** It is wired at
  `Home.tsx:10295`, as `say it in my words` on the board, through
  `editing.begin("entry", …)`. It should not have been on the list.
- `updateSignal` **has its machinery and no caller.** `editing.ts` implements
  the `signal` kind fully — the request, the optimistic update, the 404
  reload — and nothing in the world calls `begin("signal", …)`. That is a dead
  branch rather than a missing capability, and it is the cheapest of the
  remaining items because only the way in is absent.

The lesson for any future audit here: an import diff over one file measures
what that file imports, not what the surface can do. Confirming each survivor
against the whole tree is what would have caught both.

**`deleteSignal` IS DELIBERATELY NOT MIGRATED, and that is the finish for it
rather than an omission.** The world already answers a wrong pattern, and
answers it better: `not true` is a counted stance the server turns into a
suppression, with `restoreSignal` to undo. A hard delete is the flat screen's
administrative affordance and it contradicts a founder law outright — *fading
never deletes*. Porting it would have added a second, worse way to do a thing
the world already does, which is the opposite of what this goal is for. The
route stays on the server; the web client stops offering it when the flat
screens go.

The twelve, in four groups: principles (`declarePrinciple`,
`updatePrinciple`, `deletePrinciple`, `disputePrinciple`,
`reorderPrinciples`), signals (`updateSignal`, `deleteSignal`), the board
(`updateTopOfMindEntry`, `refreshGroupTopOfMind`), agent credentials
(`createAgentKey`, `fetchAgentKeys`, `revokeAgentKey`). Plus the stack graph,
which has no world answer at all and is the one real design question.

**THE GRAPH IS ONE MISSING EDGE, AND IT IS BUILT.** `/graph` drew three
columns — principles over signals over experiences. The world already drew the
lower half; what it could not draw was a principle down to the signals it grew
from. `what it grew from` is that edge, in the world's own idiom: one hop,
asked for, under the thing it is about.

Walked 2026-08-25, both ways. On a freshly declared principle the verb
correctly does not appear, because there is nothing under it. With a citation
in `principle_signals` — seeded directly, since the promotion step needs the
nightly enqueuer this stack has no trigger for, on an account that really kept
three memories and really grew a signal — the verb appears and shows the
signal beneath it. In one frame: the board's sentence, the principle under it,
the signal indented beneath that, and the memories along the bottom edge. The
three columns, as a vertical stack, with no second picture of the place you
are standing in.

### A3 — One type scale, one spacing scale, one palette

**End state.** No raw literal for size, spacing or colour at a call site in
the stylesheets the product is keeping. Every value comes from a declared
token. One token set, not three.

| | |
|---|---|
| Gate | `type-scale.test.ts` (ratchet + half-pixel ban), and the same shape for spacing and colour |
| At open | 53 font sizes (45 literal, 7 half-pixel); 47 spacing literals; 114 colour literals; 3 token sets |
| **Now** | type: **21 literals, 0 half-pixel, ratcheted**. spacing: **47, ungoverned**. colour: **114, ungoverned** |
| State | **PARTLY MET** — type done, spacing and colour untouched |

### A4 — One component per purpose; the unused deleted

**End state.** No two prefixes implement the same concept. A button, a field,
a label, a panel, a list row, a verb row, an empty state and an error whisper
each exist once and are worn by every surface that needs them. Nothing in the
tree is unreferenced.

| | |
|---|---|
| Gate | `pnpm e2e:dead-css` — the browser is asked which rule won each property on each element — plus `e2e:measure` cases comparing rendered primitives across surfaces |
| At open | 917 top-level class rules; **34** distinct prefixes; `btn-` and `profile-` each declared in two files |
| **Now** | **10** prefixes (the flat-surface deletion took 24 of them). **40 rules and 16 selector lists** proved dead and removed across two harvests, each with a zero-difference computed-style diff behind it. The label register: **25 declarations → 1**, in its own layer, ratcheted. 24 overruled rules still standing, each one named |
| State | **IN PROGRESS**, and measurable for the first time |

The modal work of 2026-08-25 is the shape every primitive follows: the card
was named the reference, the surface was written once, and the four wearers
became a selector list with a gate comparing them against the card rather than
against a literal.

**WHY THIS AUDIT HAD NO NUMBER FOR SO LONG.** Twice it was attempted by
parsing the stylesheets, and twice the parser reported zero dead rules — which
was believed for about as long as it took to check one by hand. The reason a
parser cannot answer it is three lines in `layers.css`:

    @layer base, product, chrome;

`global.css` and `system.css` are in `product`. `chrome.css` is in `chrome`, a
LATER layer, so **every declaration in it beats every declaration in the other
two regardless of specificity**. `chrome.css`'s stated job is to dress the
flat screens in the world's light, and the way it does that is by re-declaring
`global.css`'s rules in the world's voice. So `global.css` is full of rules
that still match elements, still parse, still read as alive, and decide
nothing. Specificity, order, layers, shorthand expansion and `!important` all
settle this together, and the only thing that implements all five correctly is
a browser.

**`tools/e2e/dead-css.ts`** asks one, through the DevTools protocol the Styles
pane itself uses: `CSS.getMatchedStylesForNode` returns every rule that
matched a node in cascade order, and crediting each property to the last rule
that set it says which rules won nothing. It walks seven surfaces and prints,
for every dead rule, the rule that beat it — so a deletion can be checked
rather than trusted.

**FIRST HARVEST, 2026-08-26.** 38 rules overruled on every element they
matched. Fifteen removed:

- **nine in `global.css`** — `.field-label`, `.profile-list-row`,
  `.login-tab--active`, `.btn-destructive:disabled`,
  `.profile-memory-new .profile-memory-badge`,
  `.profile-toggle-row input:disabled`, `.profile-row-name::placeholder`,
  `.profile-handle-input`, `.profile-tab.is-active` — every one beaten by a
  `chrome.css` rule naming the same elements.
- **five in `chrome.css`, beaten by `chrome.css`.** The file overrides itself:
  a rule, then a `body `-prefixed copy of it further down. The `body ` prefix
  is a fossil from before layers — the chrome layer already wins — so it only
  ever beats the other copy of itself.
- **one in `system.css`** — `:where(…):focus-visible`, superseded by the
  unlayered focus floor in `layers.css`, which beats every layer.

And the label register, which this audit named at 28 implementations, was
**declared twice inside `chrome.css`** with identical values: a four-selector
copy and an eight-selector superset six hundred lines apart. Collapsed to the
superset.

**THE DELETION WAS PROVED, NOT ARGUED.** `tools/e2e/computed-snapshot.ts`
writes down every computed style on every element of the door (both tabs), the
account page and the welcome. Taken with the change, taken again with the
stylesheets stashed, and diffed: **0 differences** across 163 elements, 26
properties and every element's box. That is what makes a deletion safe to
make rather than merely plausible.

**SECOND HARVEST — THE HALF THE PROTOCOL CANNOT REPORT.**
`getMatchedStylesForNode` only ever hands back rules that MATCHED, so a rule
matching nothing is invisible to everything above however dead it is. A second
pass reads all 615 selectors out of the five sheets and puts each one to
`querySelectorAll` on every surface, with state pseudo-classes trimmed off so
the question is whether the ELEMENT is ever on screen.

That alone is not a deletion signal, and saying why is the point of the pass:
`.jar-board-acts` matched nothing here because the walk never opened
headquarters, and `e2e:journeys` proves it very much alive. So each unmatched
selector is put to a second question — **does any source file contain the
words in it at all?** A class no `.ts`/`.tsx` in the tree mentions cannot be
put on an element by anything, whatever states a walk happens to enter. That
separates the unvisited from the unreachable, which is the separation "nothing
in the tree is unreferenced" actually needs.

**64 unreachable selectors**, every one of them a retired design still being
shipped to every visitor:

| sheet | what was still there |
|---|---|
| `global.css` | the capture-grid era — `.grid.home-grid`, `.cell.capture`, `.cap-save`, `.cap-confirm`, `.hitl-menu`, `.home-view-switcher`, `.drop-overlay`, `.top-home-capture`, `.reference-capture-modal` |
| `system.css` | the note-canvas rail and drawer — `.nc-rail*`, `.nc-drawer*`, `.nc-room-*`, `.nc-timerail*`, `.nc-save-cta` |
| `chrome.css` | the `.auth-*` shell, superseded by `.login-*` and never removed |

24 rules removed from `global.css`, 1 from `system.css`, and 16 selector lists
pruned of names nothing wears. Verified the same way: **0 computed-style
differences** across the four chrome surfaces.

**THREE TIMES THE INSTRUMENT WAS WRONG AND SAID SO.** Each was caught by
disbelieving its output rather than by it failing:

1. Keying rules on `styleSheetId` split one rule into seven, because every
   navigation re-attaches the bundle under a new id — so a rule that wins on
   the door and loses on the account page would have been reported as a
   deletion candidate.
2. The account page is tabbed and the public page is a separate route. The
   `nc-` family — about 150 selectors — is worn only by `PublicProfile.tsx`,
   and without that surface every one of them read as unused. Only the
   source-word cross-check stood between that reading and a very bad deletion.
   The surface is walked now.
3. The prefix guard that lets a constructed class like `` `card--${size}` ``
   count as spoken accepted any five-letter source word as a prefix — and the
   word `surface`, which appears in prose and identifiers all over this repo,
   therefore vouched for `.surface-shell`, a class belonging to a deleted
   screen. A prefix now has to end in a hyphen, which is what a real
   interpolation looks like.

**AND ONE FINDING THAT WAS THE OPPOSITE OF DEAD CODE.** `.jar-star` — the
point of light a sentence the person wrote wears — came back unreachable while
`motion.test.ts` still guarded it. The class was not obsolete debris: the star
had become a labelled verb, `Hand it back to WAKA`, and only half of it made
the journey. The glow followed the glyph to the new button; two rulings did
not.

- **The turn**, which is founder-gated (Phase 8, reviewed live), was left on a
  class nothing wore — so the approved motion had silently stopped happening.
  It is on `.jar-star-act::before` now with the approved numbers untouched:
  0.6s in the 0.4–0.8 band, ease-out, `both`, once on appearance.
- **"The glyph lives in the stylesheet, not the sentence"** — a written
  ruling, whose reason is that anything asking the DOM what a line says should
  get the words and not a dingbat. The labelled version had `✶ ` typed into
  the JSX, so the button's accessible name began with a six-pointed star. It
  is a `::before` again.

A gate guarding a rule for an element that no longer renders is green and
about nothing, which is the most expensive kind of green there is.

**WHAT IS LEFT: 24 overruled rules** — 10 in `global.css`, 6 in `chrome.css`,
the rest ambiguous between sheets — and whatever the next walk finds once it
enters the states this one did not: headquarters open, hover, the error paths.

**THIRD HARVEST — THE LABEL REGISTER, DECLARED ONCE.** This audit named it
at 28 implementations when it was written. Measured again on 2026-08-26, after
the flat-surface deletion took some with it: **25**, across `home.css`,
`chrome.css` and `global.css`, in **four sizes** (10px, 11px, 12px and a raw
`9px`), **five trackings** (0.08, 0.12, 0.14, 0.16, 0.18em) and **three
weights**. None of that was a decision. It was twenty-five separate attempts to
write down the same gesture from memory.

**THE NUMBERS CAME FROM WHAT RENDERED, NOT FROM WHAT WAS WRITTEN.**
`e2e:snapshot` was taken first and the computed values counted: **48 elements
already rendered at 10px / 1.6px / 500**, and every other value in the product
was worn by ten elements or fewer. So the register is what the product already
mostly looked like, said once in tokens — `--t-label`, `0.16em`, `500`,
`uppercase` — and the change is that the stragglers stopped disagreeing.

Counting the render rather than the source also decided what stays OUT, twice:

- **`.meta`** had an uppercase declaration in `global.css` that a
  `text-transform: none` rule in `system.css` had already beaten. It renders
  lowercase. Folding it in would have been a silent redesign carried in on a
  consolidation.
- **`.profile-signout-button`** likewise — and it was caught late, as the one
  `text-transform` change in the whole computed diff. `chrome.css` already
  rules that the register "belongs to eyebrows, never to things you press".

**THE HARD PART WAS NOT THE COUNT, IT WAS BEING ABLE TO WIN.** The first
attempt put the one rule in `system.css` and two things immediately beat it,
both invisible to a source read and both found by the computed diff:

1. **A `font:` shorthand in a later layer.** `chrome.css` carries
   `font: inherit` on `.profile-tabs button`. It names neither `font-size` nor
   `font-weight` and re-sets both. Stripping the longhands beside it left the
   shorthand as the winner and the account tabs jumped 10px → 16px.
2. **Import order inside one layer.** `home.css` is imported by `Home.tsx`, so
   it lands after `system.css` in the same `product` layer — and `.jar-ask`'s
   13px beat the register at equal specificity. The mouth's verbs went to 13px.

So the register got **its own layer, last**: `@layer base, product, chrome,
register`. A single declaration cannot be "the one place" while anything is
allowed to out-rank it, and nothing else may live there —
`type-scale.test.ts` fails if a second rule moves in, because a layer that
holds "things that win" is not a register any more.

**Result: one `text-transform: uppercase` in the entire tree.** The computed
diff across six surfaces shows changes to `font-size`, `font-weight` and
`letter-spacing` only, and **not one element changed case**.

**AND THE MEASURE FIXTURE WAS QUIETLY LYING.** `e2e:measure` served
`system.css` and `home.css` but not `layers.css`, so its layer order came from
first appearance — `product`, `register`, then `chrome` from `home.css` — the
opposite way round from the product for any conflict between the last two. It
passed 12/12 either way, which is the point: a fixture that disagrees with
production announces itself later, on a case nobody has written yet. It serves
`layers.css` now.

**FOURTH HARVEST — THE MODULE HALF OF "NOTHING IS UNREFERENCED".** The
stylesheet half is `e2e:dead-css`; the module half needs no browser, because
an import graph is a fact about the source. Two orphans, both left by the flat
screens deleted the same week, both of which had been sitting in the tree
looking entirely like live code:

- **`components/faces.ts`** — "Lifted out of Home so the rail can use it
  without importing a page." The rail went out with `surface.css`.
- **`lib/confidence.ts`** — 93 lines turning a confidence number into three
  named bands, written because "the flat surfaces have no light channel, so
  they printed the number instead". In the world confidence IS the light;
  nothing needs the words.

Neither was findable by grep: both had the shape of live code and names that
read like live code. What made them visible is that nothing imports them, and
that is only visible from the whole graph at once — so it is a gate now
(`orphans.test.ts`), not a script somebody remembered to run. It had to be
taught two things by watching it get them wrong: a `lazy(() => import(…))` is
an import (the first run reported `pages/Home.tsx`, the largest file in the
product, as unreferenced), and an ambient `.d.ts` is imported by nobody.

**AND ONE COMMENT THAT HAD BECOME A LIE.** `main.tsx` said: "The list surfaces
stay exactly where they were … `/inspirations` and `/signals` remain
addressable." Both redirect to `/` now. A comment naming an address that
answers with a redirect is a map of a building that has been pulled down, and
the next person reads it as the current shape of the product. Corrected, along
with `SurfaceBoundary`'s "and the flat surfaces still worked" — that file's
`surface` has never meant those screens, and it now says so.

Checked at the same time and clean: every in-app navigation target
(`to=`, `navigate(`, `href=`) names a route that still exists.

### A5 — The product on a phone

**End state.** At 390x844 and 360x640: nothing overflows sideways, no control
is hidden under another, no text field under 16px, every control clears WCAG
2.2 AA's 24x24 and the acts clear 44, and no two controls sit closer than 44px
centre to centre unless both of them are 44px in both axes.

| | |
|---|---|
| Gate | `pnpm e2e:phone`, with a negative mode that puts the shipped defects back |
| At open | unmeasured. The top row overlapped itself so the timeline could not be opened at all; every field was 15px; the capture control was 19px tall |
| **Now** | **clean at both widths across four surfaces** — the door, the world, the open mouth and **an open memory** — gate green, negative mode finds all 16 |
| State | **MET**, 2026-08-26 |

**WHAT CLOSING THIS PROPERLY COST, because the first version of it was wrong
in a way worth keeping on the record.** The audit above shipped saying "MET
for the door, the world and the open mouth — the card and the modals are NOT
yet walked". That honesty is the only reason the rest of this was found.

Walking the card turned up finding 8 reborn in the world, on the surface the
flat screens had been deleted from:

| control | measured | floor |
|---|---|---|
| `reflect` | 37x15 | 24 |
| the memory before this one | 18x14 | 24, and 44 as an act |
| the memory after this one | 18x14 | 24, and 44 as an act |
| `delete` | 37x15 | 24 |

The two carets sat **32px apart**, and `delete` — which takes a memory down —
was at half the minimum size beside them. Fixed at the four modal roots rather
than in that one footer (`.jar-panel`, `.jar-seek`, `.jar-settings`,
`.jar-prov-room`), so the next control added to any sheet inherits the floor.
The 24 is unconditional because WCAG 2.5.8 is not a touch rule and those
carets were 18x14 on a desktop too; the 44 is coarse-pointer only, the same
ruling the mouth's verbs already carry.

**AND ONE GATE WAS MOVED RATHER THAN KEPT.** `e2e:journeys`' `the-hand` used
to make the size and crowding claims. It was written for the flat surface, and
after the deletion every route and class in it was gone. Rehomed onto the
world it reported the mouth's verbs at 48x11 and 34x11, crowded — **and that
was wrong**: `the-hand` cannot emulate touch (`hasTouch` is fixed when a
Playwright context is made, and the harness makes one 1440x900 context for
every journey), so it resized a fine-pointer page, and every size that comes
from `@media (pointer: coarse)` measured at its desktop value. In a real touch
context those verbs are 45px tall and nothing is crowded.

So size and crowding both went to `e2e:phone`, which has the real pointer —
and asking crowding there is what surfaced the card table above.
`the-hand` keeps the one claim that does not depend on the pointer and that
nothing else in the repo can make: it composites every ancestor's opacity and
background and asks WCAG about the colour that actually reached the eye.
`contrast.test.ts` reads the stylesheet as text and cannot see either the
cascade across sheets or an inherited `opacity`.

### A6 — Usability

**End state.** A Nielsen heuristic pass over every surface and a WCAG 2.2 AA
pass, both written down as ranked findings with severity, and everything in
scope fixed.

| | |
|---|---|
| Gate | the findings list, each row either fixed or carrying a recorded reason |
| At open | not run |
| **Now** | the WCAG target-size and iOS-zoom criteria were covered inside A5. The heuristic pass has not been run |
| State | **NOT MET** |

**And one thing about the method.** The founder linked a skill at
`mcpmarket.com/tools/skills/user-experience-audit`. That host is blocked by
this environment's egress proxy (`EGRESS_BLOCKED`), so its methodology was not
read and is not what is being used. This audit runs on Nielsen's ten
heuristics and WCAG 2.2 AA. Claiming a method that was not used would make
every finding unverifiable, so it is recorded here rather than glossed. If
that specific skill is wanted, it needs an egress allowance for the host or
the file pasted in.

---

## Phases

Sequenced so that nothing is deleted before its replacement is seen working,
and so that the two sweeping refactors (tokens, primitives) land before the
surfaces that would otherwise have to be converted twice.

### Phase 1 — Every workflow reaches its end

Owns finding 4. The safety net for everything after it: a large refactor
against a suite that is already red cannot tell you what it broke.

Every named suite passes, or its failure is a recorded decision with a reason.
No workflow stops halfway — a suite that signs up, keeps, and then cannot
reach the thing it was about is a failure even if it reports green.

**Gate:** twelve suites, twelve green, run in one sweep.

### Phase 2 — One set of primitives

Owns finding 2's structural half. Extract the components that four prefixes
implement separately — button, field, label, panel/sheet, list row, verb row,
empty state, error whisper — into one set, convert every call site, delete
what nothing calls.

The modal surface landed on 2026-08-25 already and is the pattern: the card
was named the reference, the surface was written once, and the four wearers
became a selector list. Every primitive here follows that shape.

**Gate:** a source check that no two prefixes declare the same property for
the same concept, plus `e2e:measure` cases comparing rendered primitives
across surfaces.

### Phase 3 — One type scale, one spacing scale, one palette

Owns finding 3. Declare the scale, move the call sites, delete the two
subordinate token sets.

Not a rename. The 53 font sizes collapse to a scale small enough to hold in
the head (the existing `--t-*` set is already close: display / reading / lead
/ body / ui / meta), and every literal becomes a token reference. Half-pixel
sizes do not survive.

**Gate:** a literal `font-size`, `letter-spacing` or spacing value outside the
token set fails a source gate. The gate ships with its own sabotage.

### Phase 4 — The four real gaps move into the world

Owns finding 1. In order of how much design each needs:

1. **Agent credentials** — no design question; it is a list with an issue and
   a revoke, and the world already has a settings sheet to put it in.
2. **Signal and board editing** — the card already edits a memory's words in
   place; a pattern's sentence and a board entry are the same act on different
   layers, so this is the card's editing behaviour applied twice.
3. **Principles as a writable layer** — the world reads them and the top edge
   already names them. Declaring, disputing and ordering are new verbs on an
   existing surface.
4. **The stack graph** — the one genuine design question, and the last thing
   standing between the flat routes and deletion. The world is already a
   spatial graph; a second graph drawn flat is a contradiction that has to be
   resolved rather than ported.

Each lands with a browser walkthrough as its evidence, per the inherited bar.

### Phase 5 — The product on a phone

Owns finding 5. Measure first, at 390×844 and 360×640, every surface: the
world, the card, every modal, the doorway, the profile. Then fix what is found.

Known classes of defect to look for, none yet confirmed in the world: touch
targets under 44px, horizontal overflow, inputs under 16px (iOS zooms the page
on focus), fixed chrome ignoring `env(safe-area-inset-*)`, and **hover-only
controls** — this stylesheet has shipped three of those, and the timeline's
reveal is hover-driven with a press fallback that must be verified on touch.

**Gate:** `e2e:measure` gains a phone viewport and the world is walked at it.

### Phase 6 — Delete the flat surface

Only after Phases 4 and 5. `Surface.tsx` (2,348 lines), `surface.css` (2,093),
`AgentsScreen.tsx`, `GraphScreen.tsx`, the eleven flat routes, the `sf-`/`gr-`/
`pr-` prefixes, `parseSurfacePath`/`buildSurfacePath`, and the flat locale
helpers if nothing else calls them.

**Gate:** the routes are gone from `main.tsx`, nothing in `packages/web/src`
matches the retired prefixes, and every suite still passes.

---

## The usability audit, and one thing about it

The founder linked a user-experience-audit skill at
`mcpmarket.com/tools/skills/user-experience-audit`. **That host is blocked by
this environment's egress proxy** (`EGRESS_BLOCKED`), so its methodology was
not read and is not what was used. The audit below runs on Nielsen's ten
heuristics, WCAG 2.2 AA, and the mobile-specific criteria in Phase 5. This is
recorded rather than glossed because an audit is only worth what its method
is, and claiming a method that was not used would make every finding
unverifiable.

If the skill is wanted specifically, it needs either an egress allowance for
that host or the file pasted in.

## Out of scope, and why

- **Screen readers for the world.** Founder decision, recorded in
  `everything-in-the-world.md` and not reopened here.
- **Password recovery.** Deferred pending a mail provider, per Phase 4 of the
  earlier goal. Unchanged.
- **`/login` and `/profile`.** Not flat *screens* in the sense being retired —
  there is no memory to stand in before you are authenticated. They stay, and
  Phases 2, 3 and 5 apply to them like everywhere else.
