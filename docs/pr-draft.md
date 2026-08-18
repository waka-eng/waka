# WAKA — the three-layer world

**A place to keep what catches your attention, and to watch what it adds up to.**

You save something. WAKA reads it, and over time names the patterns it sees — as
sentences in your own words, not tags or scores. Those settle into one short
piece: what is on your mind right now.

This branch replaces a flat list of saved items with a single world you move
through.

---

## The three layers

Everything in the product is one of three things, and they stack vertically on
screen because they stack conceptually.

| | what it is | where you see it |
|---|---|---|
| **inspiration** | something you kept | the ground beneath you |
| **signal** | a pattern WAKA found across several | the sky above you |
| **top of mind** | the one thing you currently hold | where you stand |

A memory becomes evidence for a pattern. Patterns settle into one piece. You can
follow the line in either direction.

---

## What you can do

```
save something          →  it lands as an orb on the ground, before the network answers
scrub the dial          →  the world winds back; the field shows what you had kept then
walk left or right      →  your space, an agent's space, a room — each with its own stack
tap a pattern           →  its evidence comes into orbit; tap again to let it go
adopt one               →  it condenses into what you are holding
sign in from the CLI    →  with a consent step that binds the tool to one chosen space
```

Your memories are private by default. Rooms are shared. Agents that save on your
behalf get their own space rather than being mixed into yours.

---

## What is in this branch

It is really two branches, and reviewing it as one will not work.

### Part one — the product (83 commits)

The world itself: the three layers, the canvas, rooms, agent spaces, the dial,
the command-line consent flow. This is what makes the screenshots different.

### Part two — making it safe and readable (105 commits)

No new features. Nine security fixes, a restructuring so the code can be
navigated, and a test suite that went from asserting almost nothing about the
world to 118 cases.

---

## The nine security fixes

Written as what someone could have done, because that is what matters.

| # | what was possible |
|---|---|
| 1 | A saved web page could put words in your mouth — its text escaped the boundary that keeps it *data*, and was read as *instruction*, minting an attacker's sentences as your own patterns, in your voice |
| 2 | Passwords could be guessed without limit, and sign-up confirmed in advance whether an address was registered |
| 3 | One account could exhaust the shared AI budget and take the feature down for everyone |
| 4 | A connected tool could issue itself fresh credentials, so disconnecting it never disconnected it |
| 5 | One slow web page could freeze everyone's background work for fourteen minutes |
| 6 | A build setting could ship invented demo memories to real people as their own |
| 7 | Someone could publish a memory on another person's behalf |
| 8 | Signing in with Google could hand your account to whoever claimed your address first |
| 9 | Removing someone from a room left their key working |

Each has a test proven to fail against the code as it was.

---

## Running it

```bash
pnpm install
pnpm dev:local        # the real stack on one origin, API and web together
```

```bash
pnpm --filter @waka/web test     # vocabulary gate, seam gate, self-tests, 118 cases
pnpm --filter @waka/api test     # vocabulary gate, 501 cases
npx tsc --noEmit                 # per package, run as its own step
```

Start reading at [`docs/map.md`](docs/map.md) — what the three packages are, the
one path a request takes end to end, and the six files to read first.

---

## How to review this

**Do not read it end to end.** 199 files, 61,000 added lines, and most of it is
not where a mistake would be.

- **Skim part one** if that work was already agreed.
- **Spend your attention on part two**, and inside it:
  - **The security tests** — read the test, not the fix. Each one fails against
    the old code.
  - **The two defects this branch introduced**, both fixed in `59c312f`:
    removing a member from one room deleted their votes in *every* room, and the
    field was drawn from data the screen never watched for changes.
- **Large moves are proven, not asserted.** The biggest relocation came out
  byte-identical across 749 lines once the parameter changes were undone. Skim
  those; read the small connecting pieces, where the only new logic lives.

---

## Known issues

Full list with reproductions in [`docs/known-issues.md`](docs/known-issues.md).

- **Authentication has no test.** Sign-in works; the check enforcing it is never
  exercised. We deleted it entirely and all 501 tests passed. **Found by this
  branch, not caused by it.**
- **A crafted link can freeze background work for about a minute** through
  runaway text-matching. Also present before this branch.
- **A room's summary was never built** — the function returns *not implemented*
  while work to build it is scheduled and discarded on every join.
- **Email verification was removed**, deliberately: it required a proven address
  to join a room, no mail was ever sent, so nobody could join anything.
- **Rooms do not think for themselves.** A room shows patterns its members
  distilled privately and chose to share; its own contents feed nothing. This is
  the current design and it is confusing on screen —
  [`docs/decisions/every-space-owns-its-stack.md`](docs/decisions/every-space-owns-its-stack.md)
  proposes changing it.

---

## Two things to be honest about

**The codebase got bigger.** ~56,000 → ~59,600 lines. That is tests, written
explanations of why files are the size they are, and documentation.
*Restructured* here means **navigable**, not smaller.

**Nine times, a check was green while blind** — the part doing the judging was
right, and the part deciding what got judged was never tested. A vocabulary
check reported "clean" over half a file it had never read. Two security guards
could be deleted with 495 tests passing. Authentication was the largest
instance.

> **Do not only test the thing that judges. Test the thing that decides what
> gets judged.**

That rule is why the gates in this branch look paranoid, and why several of them
now fail on purpose in their own test suites.
