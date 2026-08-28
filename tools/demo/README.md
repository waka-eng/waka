# The demo kit

The demo world is the first thing WAKA shows anyone. One command seeds it
against a fresh local stack — through the public API only, so every frame
shows the product, never a hand-arranged database — and one command walks
the six scenes headlessly and proves each is on screen.

## Run it

```sh
# terminal one: the stack (GEMINI_API_KEY in .env.local — the seed derives
# real signals through the live model)
pnpm dev:local

# terminal two: the world (a few minutes — derivation is a background pass)
pnpm tsx tools/demo/seed.ts | tail -1 > /tmp/demo-creds.json

# the verification walk: six scenes, six screenshots into tools/demo/shots/
node tools/demo/walk.mjs /tmp/demo-creds.json
```

The seed prints the login credentials as JSON on its last line. Sign in
with them to record; the walk uses the same JSON to verify the world before
anyone records anything.

## The shot list

Six scenes, every one on screen within a minute of login:

1. **The poster.** One sentence at headquarters — what currently matters,
   written by the loop from Yunji's own memories.
2. **What it stands on.** Press the poster: the patterns it stands on, lit
   by who holds them — what you have answered in full ink, what only WAKA
   thinks sitting dim — and beneath them the memories, each with the quoted
   span that carried it.
3. **How it reads you.** The ≡ menu's reading: the loop's rules as
   sentences, every one pinned to the code that enforces it.
4. **The room.** Travel to *the reading circle*: the wall of shared
   statements with their owners, and the room's own poster — the sentence
   the room agreed to speak.
5. **The counted stance.** Bo's open question hangs over the room with one
   no counted against it — a no is counted, never a veto, and the question
   stays standing until the room carries or lets it fall.
6. **The door.** The room's members, and the mark of who passed through —
   Dee joined and was removed, and the door remembers without keeping
   anything Dee said.

## The cast

Yunji founds *the reading circle*; Bo and Cy join; Dee joins and is
removed (the door mark). Yunji's five captures about walks and depth
derive real signals; she says one in her own words (the star — locked
against rewriting). Two statements are shared to the wall; Bo answers one;
Bo proposes and Cy declines (the counted stance); Yunji proposes and Bo
carries it (the room first speaks).
