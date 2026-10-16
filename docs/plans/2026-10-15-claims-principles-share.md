# Three experiences: claims, the principles page, and sharing

Founder brief, 2026-10-15, three things to design and build. The founder
asked for clarifying questions and then asked for them to be answered
"based on what you think the best user experience would be". These are
the answers, written as decisions so the build has a contract. Anything
the founder overturns is overturned here first.

Design references read before deciding: `docs/six-laws.md`, the Harvest
design (artifact "WAKA Harvest", 2026-10-12), `ClaimsOverlay.tsx`,
`PrinciplesOverlay.tsx`, `PrincipleShare.tsx`, `routes/claims.ts`,
`lib/principle-generation.ts`.

## 1. Claims: one slot, one gesture, two kinds of card

Two different objects were being called "claim" in the brief. They stay
two objects on the server and become one gesture on screen.

| | Type one: a reading | Type two: a harvest candidate |
|---|---|---|
| What it is | A signal WAKA read from your saves (`signals` row) | A verbatim sentence of yours the local collector picked from yesterday's sessions |
| The question | Still true? | Keep this? |
| Right, *Still true* / *Keep it* | files `true` | becomes an inspiration |
| Left, *Not anymore* / *Not it* | files `not_true` | declined at once; the words are deleted, a reason may follow |
| Second step after left | none; the receipt offers the chat as one link | six reasons (five, or *Something else* in your own words), skippable |
| Byline | "From six things you kept" | "Inferred from your Claude MCP · Today" |
| Server work | none | new table, three routes, keeper-key allow-list |

### Decisions

**The gesture.** Pointer events, so one implementation serves mouse drag
and touch. The card follows the pointer vertically. Release past a third
of the card's height, or a short flick, commits; short of that it
settles back. The first build asked for 40% and a deliberate half-inch
phone drag settled back, so it came down. Up means yes because the
character is above the card and the character is who is asking; the
card rises into it. Down means no; the card sinks below the dock and
fades. Fading never deletes: for type one the signal still exists and
the verdict is a feedback row, exactly as the buttons filed before.
Reduced motion: no travel, the next card stands where this one stood.

**Two quiet words under the card are also the buttons.** *Not anymore*
on the left, *Still true* on the right — the directions the card moves
(as built, after the founder moved the gesture from up/down to sideways).
They are keyboard targets and the whole answer for anyone who does not
drag. Law 1: a control names exactly what it does. ArrowLeft and
ArrowRight do the same with the card focused. A *Chat about it* in the
middle, with a pull-down to match, was built and then taken off the card
(founder, 2026-10-15: "remove chat about it under the claim"); after a
no, the receipt still offers *Say what's true*.

**The answer forms inside the card.** While held, the word the card is
moving toward fades outside and comes up in light inside the card, and
the sentence dims to a third. Light is the only channel: no colour, no
tilt, no icon. Two earlier versions failed in the browser. A fixed word
was hidden by the card arriving at it, and a word carried ahead of the
card slid under the dock on a phone. The claim's container also clipped
everything outside its box, so the clip now lifts while a card moves.

**Partly is dropped from the slot.** Two directions have no third. The
thing "partly" was for, an invitation to sharpen, survives as the one
link on the receipt after a down-swipe: "say what's true instead", which
opens the conversation seeded with the statement, as the soft answers do
today. A no-swipe never opens the chat on its own; the whole value of the
gesture is that no is as cheap as yes.

**The card is the signal, not a raw save.** The founder said "revisits my
past inspirations"; what WAKA asks about is the pattern it read from
them, and the one-line "from N things you kept" is the door to those
saves. The three-line evidence list was tried and rejected for space.

**"Still" is a queue change, not a copy change.** Today the queue holds
only unanswered claims. "Is this still true" means a claim affirmed long
ago comes back. Phase two of this work: the queue serves, after the
unanswered ones, signals whose last `true` is older than ninety days,
oldest first. Phase one ships the gesture over the existing queue.

**Order in the slot.** Harvest candidates first, then readings. A
candidate is from yesterday and lapses in seven days; a reading has no
clock.

### Harvest, as built

The artifact listed `waka · docs/harvest-canon` and
`waka-mcp · feat/harvest-gather` as finished. Neither branch exists on
either remote, so the basket, its routes and its card are built here, and
the MCP gains a tool to fill it. The nightly local collector is not built.

- `harvest_candidates` (migration 0072): the words, an optional title,
  content-free context, a hash of the normalised words, a status of
  `pending | kept | declined | lapsed`, a reason, and the inspiration it
  became. A CHECK holds that words exist exactly while pending.
- `POST /api/harvest` proposes up to ten at once into the session's own
  profile. The person's own sessions may propose, the keeper key included;
  agent profiles are refused. At most thirty wait. The same sentence is
  proposed once.
- `GET /api/harvest` lists what is waiting and lapses anything older than
  seven days in the same request, deleting its words.
- Keep goes through the ordinary save with the candidate id as the save
  request id, then `POST /api/harvest/:id/keep` links the save. A retry
  finds the first save rather than making a second.
- `POST /api/harvest/:id/decline` deletes the words in the same write. The
  reason may come with it or once afterwards.
- Reasons, from the artifact: `not_mine`, `already_kept`, `private`,
  `trivial`, `miscut`. "Cut wrong" is not a no: it opens the words to fix
  and keep, and "Let it go" from there declines with that reason.
- In the slot, candidates come before readings. Right keeps; left lets it
  go at once and then asks why, with the reasons, *Something else* and
  Skip. The reason is a second, optional call, so a closed tab never leaves
  the sentence waiting.
- The MCP's `waka_propose_inspirations` posts candidates. It tells the agent
  to quote the person verbatim and never to propose its own words.

**The two founder judgments in the artifact, answered.**

Seven-day lapse deletes the text, and this is consistent with "fading
never deletes". That law protects what the person kept. A candidate is
in the basket, not the chest; it was never kept, and holding unchosen
lines from private conversations on a server indefinitely is the larger
breach. A lapsed candidate keeps context and "lapsed" and no hash, so the
collector may propose it again if it stays true.

The nightly notice is not a ping. "Never a ping" is about the product
pulling the person back. This notice is sent by the person's own
machine, from a collector they installed and switched on, once a day,
only when the basket is not empty, and it carries no count. It stays off
until turned on in the collector's settings.

## 2. The principles page: the wait is the ground being laid

The page is empty for weeks and the copy says "months". The actual bar
(`lib/principle-generation.ts`) is three active signals, each cited in a
top of mind at least once, taken by the nightly run. That bar is
reachable and the person can push on it, and that is the thrill.

**What the page shows before the first principle.** The card's own
silhouette, at reading size, with a dashed edge because it is not there
yet, and three seats inside it, one per pattern the bar asks for. A seat
a pattern holds carries that pattern's words in muted ink; an empty seat
is a faint line. The edge turns solid and warm when every seat is held.
Above it, one line in words, never numerals: "So far two patterns are
holding. With one more, a principle can begin." Under it, when WAKA has a
claim waiting, "Answer what WAKA is asking", which goes back to the claim
on the home screen. A seat that filled since the last visit lights up
once on arrival; that is the only motion on the page.

The seats show active patterns, not only the ones you answered yes to.
Signals carry no verdict to the client, so "ratified only" cannot be
built honestly today. Active patterns are already yours to see as claims
and in the sky, so nothing is revealed early.

**What is never shown.** Candidate wording. The generator's receipts are
private and a principle seen before it is minted makes the mint a
non-event.

**The arrival.** The first time this device sees principles on a
profile that showed the waiting page before, the page says "Your first
principle is here." and the first card comes up in light. Once. Someone
whose principles already existed on their first visit is not greeted.
Not built yet: the character carrying the first principle on the home
screen.

**Who "users" are.** Public, through the existing public profile. A
principle is private by default. Sharing it as an image never requires
publishing. Showing it on the public page is a per-principle switch,
off until the person moves it.

## 3. Sharing: preview first, one press

Three things can be shared: a save, the current top of mind, a
principle. The renderer and draft storage from `PrincipleShare` are
kept. The sheet is replaced; it is a form today (selects, a details
block, a textarea, a checkbox) and the ask is Strava.

**One `ShareSheet` for all three kinds.** The image fills the sheet.
Under it, a row of looks as thumbnails, not selects: dark square, light
square, dark story, light story. A name switch. One primary action:
"Share" opens the native sheet where it exists, "Save image" otherwise.
Editing the words is a single link that opens an inline field; draft
storage keeps working and is never mentioned.

**Image only.** A link is offered only for a principle already on the
public page. Saves and top of mind never get a link, since nothing of
the person's is public unless they moved it.

**What each card carries.**
- Save: the words; a photo save puts the photo above the words; audio
  uses the transcript; a link uses title and domain. Byline "kept
  October 3".
- Top of mind: the statement, "On my mind, October 2026", and the proof
  "from twelve things kept this month".
- Principle: as today, with the held-since proof line.
- All three: a small WAKA mark in the lower corner. It is the one brand
  element on the card and it is the whole growth loop.

**Identity.** Name off by default on every kind. The choice is
remembered on the device once made.

**Where share lives.** A share control on the save's own page, on the
top-of-mind band, and on the principle card as now. Never a long-press.

## Order of work

As planned on the day (it landed as one stack of five PRs, #428–#432,
after the founder's review rounds):

1. `claude/claim-swipe`: the gesture over the existing queue, type one.
2. `claude/share-sheet`: the sheet for all three kinds.
3. `claude/principles-ground`: the waiting page and the arrival.
4. `claude/harvest`: table, routes, keeper allow-list, the type-two card
   and reason chips.
5. The ninety-day re-ask, after 1 ships.
