# WAKA: the three-layer world, and a month of making it safe to keep

*Draft PR description. Not opened — see “How to review this” for why the shape
matters more than usual.*

---

## What this is, in one paragraph

WAKA is a place to keep the things that catch your attention, and to watch what
they add up to. You save something. WAKA reads what you save and, over time,
names the patterns it sees — not as tags or scores, but as sentences in your own
language. Those sentences settle into one short piece: what is on your mind
right now. This branch is that idea, built. It replaces a flat page of saved
items with a single world you move through: your memories on the ground beneath
you, the patterns forming in the sky above, and the one thing you currently hold
where you stand.

## Why it needed to change

The old screen was a list. A list is a good way to store things and a bad way to
notice anything. You could scroll a hundred saves and learn nothing you did not
already know, because nothing on that page ever said *these three belong
together* or *you have come back to this four times this month*.

The change is not visual. It is that the product now has an opinion about what
you saved, and a place to put that opinion where you will see it.

## What a person can do now that they could not before

- **See what a save turned into.** A memory you keep is no longer just stored —
  it becomes evidence for a pattern, and you can follow the line from the
  pattern back to the memories underneath it.
- **Watch a thought change.** When the summary of what is on your mind is
  rewritten, words that survived stay lit and new ones arrive. You can see what
  moved.
- **Go back in time.** A dial winds the world back, so the field shows what you
  had kept at that moment, not what you have kept since.
- **Stand in someone else's space.** Your own memories are private by default.
  Rooms are shared, and agents that save on your behalf get their own space
  rather than being mixed into yours.
- **Sign in from the command line** with a real consent step, so a tool acting
  for you binds to one chosen space rather than your whole account.

## What is in this change, in two parts

It genuinely is two things, and it will read better if you treat them that way.

**Part one — the product (83 commits).** The world itself: the three layers, the
canvas, rooms, agent spaces, the dial, the command-line consent flow. This is
what makes the screenshots look different.

**Part two — making it safe and readable (105 commits).** No new features. Nine
security fixes, a large restructuring so the code can be navigated, and a test
suite that went from asserting almost nothing about the world to 118 cases.

## The nine security fixes, in plain terms

Each of these was found by reading code carefully enough to move it, not by an
alarm going off.

1. **A saved web page could put words in your mouth.** Text on a page could
   escape the boundary that keeps it as *data* and be read as *instruction*,
   which meant an attacker's sentences could be minted as your own patterns, in
   your voice.
2. **Passwords could be guessed without limit**, and the sign-up page confirmed
   in advance whether an address was registered.
3. **One account could exhaust the shared AI budget** and take the feature down
   for everyone.
4. **A connected tool could issue itself fresh credentials**, so disconnecting it
   never actually disconnected it.
5. **One slow web page could freeze everyone's background work** for fourteen
   minutes.
6. **A build setting could ship invented demo memories to real people** as if
   they were their own.
7. **Someone could publish a memory on another person's behalf.**
8. **Signing in with Google could hand your account to whoever had claimed your
   address first.**
9. **Removing someone from a room left their key working.**

## What is still broken, and known

A short list here; the full one with reproductions is in `docs/known-issues.md`.

- **Authentication has no test.** Sign-in works, but the check that enforces it
  is never exercised — we deleted it entirely and all 501 tests still passed.
  Not caused by this branch; found by it.
- **A crafted link can freeze background work for about a minute** through
  runaway text-matching. Present before this branch too.
- **A room's summary was never built.** The function returns "not implemented"
  while work to build it is scheduled and thrown away every time someone joins.
- **Email verification was removed**, deliberately. It required proving an
  address before joining a room, no mail was ever sent, and so nobody could
  join anything. Sign-up now believes the address it is given.
- **Rooms do not think for themselves.** A room shows patterns its members
  distilled privately and chose to share. Its own contents feed nothing. This is
  the current design, it is confusing on screen, and
  `docs/decisions/every-space-owns-its-stack.md` proposes changing it.

## How to review this

**Do not read it end to end.** It is 199 files and 61,000 added lines, and most
of it is not where a mistake would be.

- **The 83 product commits** are the world itself. If that work was already
  agreed, skim it.
- **The 105 hardening commits** are where to spend attention, and inside those:
  - **The security fixes.** Each has a test proven to fail against the code as
    it was. Read the test, not the fix.
  - **The two defects this branch introduced**, both fixed in `59c312f`:
    removing a member from one room deleted their votes in every room, and the
    field was drawn from data the screen did not watch for changes.
- **Large moves are proven, not asserted.** Where code was relocated, the diff
  was checked mechanically — for the largest move, 749 lines came out
  byte-identical once the parameter changes were undone. **Skim those. Read the
  small connecting pieces instead**, which is where the only new logic lives.

## One thing to be honest about

**The codebase got bigger, not smaller.** Roughly 56,000 lines to 59,600. That
is tests, explanations of why files are the size they are, and documentation.
"Restructured" here means *navigable*, not *smaller*, and anyone expecting the
second number to go down should know it did not.

## The pattern worth carrying forward

Nine times in this work, a check was **green while blind** — the part doing the
judging was correct, and the part deciding what got judged was never tested. A
vocabulary check reported "clean" over half a file it had never read. Two
security guards could be deleted with 495 tests passing. Authentication turned
out to be the largest instance.

The rule that came out of it, and the reason the gates in this branch look
paranoid:

> **Do not only test the thing that judges. Test the thing that decides what
> gets judged.**
