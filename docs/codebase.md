# Organising this codebase

**The goal: a new engineer can find where a change belongs, and make it without
reading the whole product.**

That is the measure. Not file count, not line count — whether someone who has
never seen this repo can answer "where does this go?" and then change it
without a second file surprising them.

Today they cannot, and the evidence is in the bug history rather than in
anyone's opinion. In one session: memories from every wall piled at the world
origin because the layout learned about walls and the renderer did not; both
profile tabs rendered at once because a rule set `display` on an element using
`hidden`, three separate times; a whole design pass landed in dev and not in
production because two stylesheets disagreed and bundle order decided. Every
one is the same shape — **one part of the codebase not knowing what another
part assumed.**

## Where it stands

```
13,663  packages/web/src/pages/World.tsx     the entire product, one file
 3,043  packages/web/src/styles/global.css   tokens --ink / --rule / --paper
 1,755  packages/web/src/styles/world.css    tokens --jar-*
 1,710  packages/api/src/routes/groups.ts
 1,684  packages/web/src/lib/api.ts
 1,098  packages/web/src/styles/world-chrome.css  tokens --w-*, repoints main's
```

Three token vocabularies for one product. One file holding a canvas renderer, a
physics loop, sprite baking, a palette, data loading, twenty pieces of React
state, and every panel's markup.

## The order, safest first

Each step is independently valuable and independently revertable. Do them in
this order because each makes the next cheaper — and stop at any point without
leaving the repo worse.

### 1. A map (`docs/architecture.md`)

Highest value per hour, and it costs nothing to be wrong about. Forty lines
saying:

- the three layers are the three vertical sections: inspiration → **field**,
  signal → **sky**, top of mind → **headquarters**
- one column per mind: yours, each agent's, each room's
- `world-data.ts` is the ONLY translation between the canon's words and the
  world's
- `SimApi` is the boundary between React and the canvas; nothing crosses it
  another way
- what each package is for, and which screens are deliberately flat

Nobody can navigate the rest of this list without it.

### 2. `@layer` for CSS ownership

Declare `@layer base, product, chrome;` once (done — `styles/layers.css`), then
assign every stylesheet in ONE change. Not file by file: unlayered rules beat
all layers, so moving one file in while its neighbours stay out drops it below
them rather than raising it. Wrapping `world-chrome.css` alone was tried and
instantly reverted every override it exists to make. Precedence then stops
depending on import order — which is the bug that made a
design pass apply in dev and not in production, with identical source. It is a
handful of lines and it removes an entire category of failure.

### 3. One token vocabulary

`--ink`/`--rule`/`--paper`, `--jar-*` and `--w-*` describe the same product in
three languages, and `world-chrome.css` exists mostly to translate between
them. Collapse to one set. The translation layer then deletes itself.

### 4. Split `World.tsx`

Only after 1–3, because those make the seams visible. In dependency order:

- **`world/sim/`** — the rAF loop, sprite baking, palette, layout, ball state.
  The seam already exists: `SimApi`. This is moving code, not redesigning it.
- **`world/panels/`** — memory, sky, room, capture mouth. Independent markup
  that only reads state.
- **`world/state/`** — loaders and hooks: `loadRoom`, the ball-list build, hue
  assignment.

**Started.** `lib/world-appearance.ts` is the first piece out: the per-member
hue system, extracted because none of it touches React or the frame loop.
That is the test for whether something can leave — *does it need the loop or
the component?* If not, it belongs in `lib/`, and moving it is safe. Working
outward from the pure edges is why this can be done incrementally at all,
unlike the CSS layers above, which have to move all at once.
- what remains is a page that wires three things together, readable in one
  sitting.

## Rules worth keeping while doing it

- **Never set `display` on an element that uses the `hidden` attribute.** It is
  the weakest display declaration there is; any author rule silently disables
  it. This cost three separate bugs.
- **Never rely on import order for precedence.** Use `@layer` or specificity.
- **One fact, one owner.** The wall a ball belongs to is decided in one place
  and read everywhere. When the layout knew and the renderer did not, the
  result was memories stacked at the origin.
- **A rule nobody can execute is a rule nobody has checked.** Route tests that
  inject mocks prove the route calls a function, not that the function is
  right. Extract the rule (`carriesMajority`, `mayAnswerSignal`) so a test can
  run it.

## How to know it worked

A new engineer, given "make an agent's memories render differently", can find
the file in under a minute and change it without touching the sim loop, the
data layer, or another wall's behaviour.
