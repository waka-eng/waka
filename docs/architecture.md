# Where things live

Read this before `Home.tsx`. It is the map that file assumes you already have.

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

## Space — the one word this codebase invents

A **space** is a thing that owns a full set of three layers. Your own is one.
Each of your agents has one. Each group has one.

It is worth knowing that this word appears nowhere in the API or the canon,
and that is not drift — it fills a real gap. The backend has `profiles` and it
has `groups`, and no single noun for "the thing whose inspirations, signals and
top of mind these are". The frontend needs that noun, because every space
renders identically and differs only in whose material it holds.

| A space | Is backed by |
| --- | --- |
| yours | your human profile |
| an agent's | an agent profile |
| a group's | a group, and its members' public captures |

Everything else in the frontend uses the canon's words, so this is the one
term to learn that is not already in `docs/data-model.md`.

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

**`packages/web/src/lib/data.ts`** — where the three layers become the three
vertical sections a person moves through. It is NOT a translation, and this
paragraph used to say it was.

That is worth stating rather than quietly correcting, because the old design is
the one a reader will expect. This file carried a second vocabulary: an
inspiration was a `WorldCapture`, a signal a `WorldPattern`, the loaders were
`loadField` / `loadSky` / `loadHeadquarters`. Every reader had to hold two words
for one thing, and this module was the only place they met.

**That translation was deleted.** The canon's nouns now run unbroken from the
Postgres column through the route to the view model, and
`packages/web/scripts/check-vocabulary.mjs` fails the build if a second word for
a canon noun reappears in an identifier.

What survives is not a synonym table but a distinction:

| register | words | where it is legal |
| --- | --- | --- |
| **canon** | inspiration, signal, top of mind, profile, group | every identifier, column and payload, both packages |
| **world** | the field, the sky, headquarters, the ground, an orb, a wall | prose and UI only — they name WHERE a layer is drawn, never what it is |
| **human** | "room", "kept", "let go" | strings a person reads on screen |

So a signal is a signal in the database, in the route, in the client and in the
view model. It is drawn *in the sky*, and a person on screen reads about their
*rooms*. `field`, `sky` and `headquarters` may appear in a comment or on screen
and never in a type, a function or a path.

One deliberate lossy flatten remains and is not a vocabulary at all: the canon's
`visibility: "private" | "public"` becomes `isPublic: boolean` in the view
model. `data.ts` documents why at the site.

User-facing text is a third thing again: it says **inspiration**, because that
is what the product calls itself — the page title is "WAKA — Inspirations".

**`SimApi`** (inside `Home.tsx`) — the boundary between React and the canvas.
React calls into the sim through it; the sim never reaches into React. Every
new canvas capability is a method on this interface.

**`packages/web/src/lib/api/`** — the only place HTTP happens. One module per
resource, each named after the route file that answers it, so the two sides are
mirrors: `groups.ts` here calls `groups.ts` there. Route handlers live in
`packages/api/src/routes/`. The shared fetch wrapper is `api/http.ts`, and its
verb helpers are deliberately not re-exported from `api/index.ts` — a page that
could reach them could decide a request shape for itself, and then this would
no longer be the only place HTTP happens.

**`ball.agentId`** — which wall a memory stands on. Decided once, when the ball
list is built, and read everywhere. Getting this wrong stacked every wall's
memories at the world origin.

## Screens that are deliberately NOT the world

`/profile` and `/login` are flat, and should stay flat: text that reflows at
200%, focus traps, plain confirmations — things in-world UI cannot give.
`chrome.css` gives them the world's palette without its geometry.

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
