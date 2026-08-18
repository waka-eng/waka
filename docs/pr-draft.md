# WAKA

**A place to keep what catches your attention, and to watch what it adds up to.**

You save something. WAKA reads it, and over time names the patterns it sees — as
sentences in your own words, not tags or scores. Those settle into one short
piece: what is on your mind right now.

It is one screen. Not a list of saves, but a world you move through.

---

## The three layers

Everything in the product is one of three things. They stack vertically on
screen because they stack conceptually — you stand in the middle of your own
thinking, with the raw material below and the patterns above.

| | what it is | where you see it | who can see it |
|---|---|---|---|
| **inspiration** | something you kept | the ground beneath you | private by default |
| **signal** | a pattern found across several | the sky above you | yours, shareable into a room |
| **top of mind** | the one thing you currently hold | where you stand | yours; a room has one too |

A memory becomes evidence for a pattern. Patterns settle into one piece. You can
follow the line in either direction — tap a pattern and its evidence comes into
orbit around it.

**Three words for three registers, and they are kept apart on purpose.** The
canon words above are what the database, the API and every identifier say. *The
field, the sky, headquarters* name **where** a layer is drawn and belong only in
prose and UI. *Room* is the warmer word a person reads on screen for a group. A
check fails the build if the first register leaks into the wrong place.

---

## Moving through it

Two axes. Up and down is **when**. Side to side is **whose**.

```
        the sky            patterns still forming
           |
   ────────┼────────       headquarters — what you hold
           |
       the ground          every memory you kept

   agents ← you → rooms    each space has its own full stack
```

- **Scrub the dial** and the world winds back — the ground shows what you had
  kept at that moment, not what you have kept since.
- **Walk sideways** into an agent's space or a room. An agent that saves on your
  behalf gets its own stack rather than being mixed into yours.
- **Tap a pattern** to bring its evidence into orbit. **Adopt** one and it
  condenses into what you are holding.

---

## Where things live

```
packages/api      the server, the schema, and the generation pipeline
packages/web      the product — one canvas screen, plus a few flat pages
packages/admin    an internal queue inspector, not deployed
```

**Start with [`docs/map.md`](docs/map.md)** — it names the three packages, walks
one save from the browser to a row and back, and lists the six files to read
first. Its file paths are checked by a test, so it cannot quietly rot.

### The server

| path | what is in it |
|---|---|
| `src/index.ts` | 94 lines, and the API's table of contents |
| `src/routes/` | one file per surface; `groups-*` and `inspirations-*` split by concern so an authorization question has a short file for an answer |
| `src/lib/signal-*.ts` | how a save becomes a pattern: gather, extract, match-or-mint, lifecycle |
| `src/lib/top-of-mind-*.ts` | how patterns become the one piece |
| `src/queue/`, `src/lib/queue.ts` | Postgres *is* the queue; a job is a row |
| `src/db/` | Drizzle schema, one file per group of tables |

`groups-field.ts` is worth knowing about: it is the only place the group module
reads layer 1, deliberately kept to one short file so *"can a private memory
escape a room?"* has one place to be answered.

### The product

| path | what is in it |
|---|---|
| `src/pages/Home.tsx` | the world — the canvas, the frame loop, the panels |
| `src/space/` | one directory per layer: `inspiration/`, `signal/`, `top-of-mind/` — split by **layer** |
| `src/space-kinds/` | how spaces differ: yours, an agent's, a room's — split by **kind** |
| `src/canvas/` | palette, sprites, and the measured DOM handles the loop reads |
| `src/lib/api/` | the only place the browser does HTTP, one file per resource, mirroring the server's routes |
| `src/lib/data.ts` | payloads become view models — and it is *not* a translation; the canon's words run straight through |

The `space/` versus `space-kinds/` distinction is the one thing here whose names
do not explain themselves — [`src/space/README.md`](packages/web/src/space/README.md)
exists for exactly that.

---

## Running it

```bash
pnpm install
pnpm dev:local                     # API and web on one origin
```

```bash
pnpm --filter @waka/web test       # vocabulary gate, seam gate, self-tests, 118 cases
pnpm --filter @waka/api test       # vocabulary gate, 501 cases
npx tsc --noEmit                   # per package, as its own step
```

The gates run before the tests and are not optional. They check that one name
means one thing, that every test suite states which layer it replaces, and —
because this repo has been bitten by it — that each gate can still *fail*.

---

## What this branch changes

The world itself — the three layers, the canvas, rooms, agent spaces, the dial,
the CLI consent flow — plus a restructuring so the code can be navigated, nine
security fixes, and a test suite that went from almost nothing to 118 cases.

<details>
<summary><strong>The nine security fixes</strong> — what someone could have done</summary>

| # | what was possible |
|---|---|
| 1 | A saved web page could put words in your mouth — its text escaped the boundary keeping it *data* and was read as *instruction*, minting an attacker's sentences as your own patterns, in your voice |
| 2 | Passwords could be guessed without limit, and sign-up confirmed in advance whether an address was registered |
| 3 | One account could exhaust the shared AI budget and take the feature down for everyone |
| 4 | A connected tool could issue itself fresh credentials, so disconnecting it never disconnected it |
| 5 | One slow web page could freeze everyone's background work for fourteen minutes |
| 6 | A build setting could ship invented demo memories to real people as their own |
| 7 | Someone could publish a memory on another person's behalf |
| 8 | Signing in with Google could hand your account to whoever claimed your address first |
| 9 | Removing someone from a room left their key working |

Each has a test proven to fail against the code as it was.
</details>

---

## Reviewing this

199 files, and most of them are not where a mistake would be.

- **Read the security tests**, not the fixes. Each fails against the old code.
- **Read the two defects this branch introduced**, fixed in `59c312f`: removing
  a member from one room deleted their votes in *every* room, and the field was
  drawn from data the screen never watched.
- **Skim the large moves.** They were checked mechanically — the biggest came
  out byte-identical across 749 lines. The new logic is in the small connecting
  pieces between them.

**One thing to know before you start: authentication has no test.** Sign-in
works, but the check enforcing it is never exercised — deleting it leaves all
501 tests passing. It predates this branch. Do not read a green suite as cover
for the auth paths.

Other known issues, with reproductions, are in
[`docs/known-issues.md`](docs/known-issues.md) — including a room's summary
never having been built, and why a room can show five patterns above an empty
ground and still be working as designed.

The line count went **up**, ~56,000 → ~59,600: tests, documentation, and written
reasons for why files are the size they are. *Restructured* here means
navigable, not smaller.
