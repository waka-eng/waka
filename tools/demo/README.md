# The demo kit

The demo world is the first thing WAKA shows anyone. One command seeds it
against a fresh local stack — through the public API only, so every frame
shows the product, never a hand-arranged database — and one command walks
the three scenes headlessly and proves each is on screen.

## Run it

```sh
# terminal one: the stack (GEMINI_API_KEY in .env.local — the seed derives
# real signals through the live model)
pnpm dev:local

# terminal two: the world (a few minutes — derivation is a background pass)
pnpm tsx tools/demo/seed.ts | tail -1 > /tmp/demo-creds.json

# the verification walk: three scenes, three screenshots into tools/demo/shots/
node tools/demo/walk.mjs /tmp/demo-creds.json
```

The seed prints the login credentials as JSON on its last line. Sign in
with them to record; the walk uses the same JSON to verify the world before
anyone records anything.

## The shot list

Three scenes, every one on screen within a minute of login:

1. **The poster.** One sentence at headquarters — what currently matters,
   written by the loop from Yunji's own memories.
2. **What it stands on.** Press the poster: the patterns it stands on, lit
   by who holds them — what you have answered in full ink, what only WAKA
   thinks sitting dim — and beneath them the memories, each with the quoted
   span that carried it.
3. **How it reads you.** The ≡ menu's reading: the loop's rules as
   sentences, every one pinned to the code that enforces it.

### Scenes 4, 5 and 6 are gone (2026-10-15)

**The room**, **the counted stance** and **the door** all showed *the reading
circle* — a room, its wall, an open question with one no counted against it,
and the membership mark left behind when Dee was removed. Rooms were removed
from the product (founder: "방 없애"), so there is nothing left to photograph.

**What the demo loses:** its only multi-person story. Scenes 1–3 are one
person looking at their own memory. Everything that showed WAKA holding more
than one person at once went with the room.

## The cast

Yunji's five captures about walks and depth derive real signals; she says one
in her own words (the star — locked against rewriting).

Bo, Cy and Dee are still signed up by the seed, so it still produces four
real accounts — but only Bo writes anything, and nothing is shared between
any of them. The founding of *the reading circle*, the joins, Dee's removal,
the shared statements, Bo's answer, Cy's decline and the room's first
sentence all went with scenes 4–6.
