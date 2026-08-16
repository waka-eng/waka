# Organising this codebase

**The goal: a new engineer can find where a change belongs, and make it without
reading the whole product.**

That is the measure. Not file count, not line count — whether someone who has
never seen this repo can answer "where does this go?" and then change it
without a second file surprising them.

Today they cannot, and the evidence is in the bug history rather than in
anyone's opinion. In one session: memories from every space piled at the
origin because the layout learned about spaces and the renderer did not; both
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

## The shape of the repo, and where the world sits in it

```
packages/api             100 source files   the backend: routes, db schema, generation
packages/web              35 source files   the product: World.tsx, the flat screens
packages/admin             7 source files   internal tooling
packages/apis              0 source files   EMPTY — node_modules and nothing else
packages/design-system     0 source files   EMPTY — node_modules and nothing else
```

**Two of those five packages are ghosts.** No `package.json`, no source, never
imported — but `pnpm-workspace.yaml` globs `packages/*`, so they get
`node_modules` and appear in every listing as though they mean something.

They actively mislead. A `design-system` package is exactly where a new
engineer would look before writing styles, and finding it empty *after*
writing them is the wrong order. That is not hypothetical: this branch added
`world-chrome.css` and a token repoint without ever checking whether a design
system already existed, because the directory listing implied one did and the
absence of any import implied one did not, and neither signal was checked.

**Delete both.** They cost nothing to remove and every reader something to
ignore. If a design system is coming, an empty directory is not how to reserve
the name.

## Where this branch's changes live

Almost all of it lands in two files and their satellites:

| File | Lines | What it is |
| --- | --- | --- |
| `packages/web/src/pages/World.tsx` | 13,600 | the entire product surface |
| `packages/web/src/styles/world.css` | 1,755 | the world's appearance |
| `packages/web/src/styles/world-chrome.css` | 1,098 | the flat screens in the world's light |
| `packages/api/src/routes/groups.ts` | +174 | rooms: the field, the majority rule |
| `packages/web/src/lib/world-data.ts` | 406 | the one canon↔world translation |
| `packages/api/src/routes/feedback.ts` | +100 | who may answer whose statement |

The dependency is lopsided and worth naming: **everything in the world depends
on `World.tsx`, and `World.tsx` depends on almost nothing.** That is the shape
of a file that grew rather than one that was designed, and it is why the four
steps below are ordered the way they are.

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

### 4. Split `World.tsx` — the decided shape

```
web/src/
  space/                what EVERY space has, one directory per layer
    inspiration/        orbs, layout, the memory panel, the capture mouth
    signal/             statements, verdicts, joining, proposals
    top-of-mind/        the poster, provenance, the version history
  space-kinds/          how spaces DIFFER
    self.ts
    agent.ts            machine hand · pixelated orbs · quantized motion
    group.ts            members · hues · legend · proposals
  transition/           moving between spaces
  canvas/               the loop, sprites, camera, hit-testing
  lib/                  data.ts · words.ts · appearance.ts
  account/              the flat screens: profile, login
```

**No wrapper.** `world/` only existed to contrast with the archive, and the
archive is deleted — a word naming what something is NOT, once the something
else is gone. `space/` beside `account/` states the real split, spatial versus
flat, without a container to explain. It also ends the doubling: `lib/data.ts`,
not `world/lib/world-data.ts`.

**Canon words name the layer directories** — `inspiration`, `signal`,
`top-of-mind` — so one vocabulary runs from the database to the folder:
`api/routes/inspirations.ts` ↔ `space/inspiration/`. *Field*, *sky* and
*headquarters* stay as the words for WHERE these are drawn: spatial, and so
they belong in the UI and its comments rather than in paths.

**`group`, not `room`** — the API already says `groups.ts`, `group_members`,
`groupTopOfMindProposals`. One word, both ends. "Room" survives in what a
person reads on screen, which is a different register again.

**`canvas/`, not `sim`** — it names the real boundary in this app. Everything
in it happens on the canvas element; everything outside it is DOM. A new
engineer knows what is inside without being told.

**Everything under `space/` because there is never one of anything.** Seven
spaces are on screen right now. A group's inspirations and yours are the same
code with different contents — `presentBalls()` already filters one list by
`ball.agentId`, and the structure should say so.

**`space-kinds/` fixes a bug class, not just tidiness.** "How does an agent's
space differ" is answered independently in at least six places today —
`isMachineWall`, `wornBeing`, `hasSky`, `hasDial`, the `data-kind` typography
selector, `mechAt`'s quantization — and they have disagreed in production: a
body hashed from a group id, typography and motion wired separately, "Our
agents" reading as a machine's space in one place and a human's in another.
One file owning what an agent's space IS makes that impossible, and a new kind
of space becomes a new file rather than a hunt through 13,000 lines.

### How to get there

Only after 1–3, because those make the seams visible. In dependency order:

- **`world/sim/`** — the rAF loop, sprite baking, palette, layout, ball state.
  The seam already exists: `SimApi`. This is moving code, not redesigning it.
- **`world/panels/`** — memory, sky, room, capture mouth. Independent markup
  that only reads state.
- **`world/state/`** — loaders and hooks: `loadRoom`, the ball-list build, hue
  assignment.

### What makes a module, rather than a pile

The test is not "are these functions small" — it is **does the group have ONE
reason to exist**, statable in a sentence, such that you can read the whole
file and know what belongs in it.

- `lib/world-words.ts` — *data turned into the words this world says.* Every
  function takes a fact and returns a phrase. It says "four days ago" and "you
  and your agent", never "4d" or "2 members".
- `lib/world-appearance.ts` — *whose memory this is, in colour.* Given a ramp
  and a member's slot, returns colours.

A good boundary asserts itself while you cross it. Lifting `dateWords` pulled
in `ordWords`, `yearWords` and `numWords`, and those pulled their word tables —
because they were always one thing. That is the boundary telling you where it
is, and it is why extraction should follow the compiler rather than a plan.

**Started.** `lib/world-appearance.ts` was the first piece out: the per-member
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
- **One fact, one owner.** The space a ball belongs to is decided in one place
  and read everywhere. When the layout knew and the renderer did not, the
  result was memories stacked at the origin.
- **A rule nobody can execute is a rule nobody has checked.** Route tests that
  inject mocks prove the route calls a function, not that the function is
  right. Extract the rule (`carriesMajority`, `mayAnswerSignal`) so a test can
  run it.

## How to know it worked

A new engineer, given "make an agent's memories render differently", can find
the file in under a minute and change it without touching the sim loop, the
data layer, or another space's behaviour.
