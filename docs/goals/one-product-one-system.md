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
