# Where things live

Read this before `World.tsx`. It is the map that file assumes you already have.

## The product in one paragraph

Waka holds three layers of memory — what you kept, what was read out of it,
and who you are becoming — for you and for your agents, and shows them as a
place you walk around in.

## The three layers ARE the three sections

`docs/data-model.md` is the vocabulary of record. The world renders it
vertically, and this mapping is the single most useful fact in the codebase:

| canon | world section | what you see |
|---|---|---|
| inspiration (layer 1) | **the field** | one orb per memory, below you |
| signal (layer 2) | **the sky** | statements still forming, above you |
| top of mind (layer 3) | **headquarters** | one sentence, where you stand |

A signal is promoted `emerging → active` at **3 pieces of evidence**
(`docs/generation.md`), enforced by a database trigger as well as by the
derivation pass.

## One column per mind

Walls run left to right: your agents, then you, then your rooms. Each wall is
one mind and has its own full three layers. The axis along the bottom edge is
the map of them.

A **room** never generates a signal. Members form statements on their own
walls and share them in; a room's field is its members' *public* captures.
See `GOAL.md` for how a room's top of mind gets approved.

## The seams — where one part stops and another begins

Four boundaries carry almost all the coupling in this codebase. Cross them
deliberately.

**`packages/web/src/lib/world-data.ts`** — the ONLY translation between the
canon's words and the world's. If you find yourself mapping `signal` to
`pattern` anywhere else, it belongs here.

**`SimApi`** (inside `World.tsx`) — the boundary between React and the canvas.
React calls into the sim through it; the sim never reaches into React. Every
new canvas capability is a method on this interface.

**`packages/web/src/lib/api.ts`** — the only place HTTP happens. Route
handlers live in `packages/api/src/routes/`.

**`ball.agentId`** — which wall a memory stands on. Decided once, when the ball
list is built, and read everywhere. Getting this wrong stacked every wall's
memories at the world origin.

## Screens that are deliberately NOT the world

`/profile` and `/login` are flat, and should stay flat: text that reflows at
200%, focus traps, plain confirmations — things in-world UI cannot give.
`world-chrome.css` gives them the world's palette without its geometry.

## The laws

These are design constraints with teeth; breaking one is a bug, not a taste
difference.

- **Light is the only meaning channel.** Brightness says aliveness. When a
  second fact needed saying (whose memory it is), it took HUE, because
  luminance was already spoken for.
- **Motion explains, never decorates.**
- **The world never moves unless the user moved it.**
- **Fading never deletes.** A signal that loses its grounds is demoted.
- **States render, numerals never.** A room's vote shows *who* agreed, not
  "3 of 5".

## Working rules learned the hard way

- Never set `display` on an element that uses the `hidden` attribute — it is
  the weakest display declaration there is, and any author rule silently
  disables it. Cost three separate bugs.
- Never rely on stylesheet import order for precedence. It holds in dev and
  not in a production bundle.
- A rule nobody can execute is a rule nobody has checked. Extract it
  (`carriesMajority`, `mayAnswerSignal`) so a test can run it.

## Running it

- `pnpm dev:local` — the real stack on one origin (API + web), rebuilding on
  save. This is the one that matters.
- `pnpm --filter @waka/web dev` — Vite alone. In dev the world renders a
  fixture without a session, which is how wall-specific behaviour gets checked.
- Tests need a local database whose name contains `test`; see `docs/codebase.md`.
