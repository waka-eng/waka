# The failure-path audit — what the product says when a press does not go through

**Date:** 2026-08-26
**Instrument:** `pnpm e2e:when-it-fails [--kind 500|drop|401]`
(`tools/e2e/when-it-fails.ts`)

## Why this audit existed to be done

Every gate in this repo walks the happy path. There is exactly one that goes
anywhere near a failure — `pnpm e2e:journeys --negative`, which breaks the one
route each journey rests on and requires the journey to **fail**.

That check is real and load-bearing, and it proves precisely one thing: the
journey is not decoration. It asserts that the success text never appeared.

It says nothing at all about whether the person was told anything.

A screen that swallows a failure in total silence passes `--negative`
perfectly, because silence is not success. So fifteen journeys had been
running against deliberate sabotage for weeks, all passing, while nobody had
ever asked the other half of the question.

The two runs now ask both:

| run | question |
| --- | --- |
| `e2e:journeys --negative` | did the success state correctly **not** appear? |
| `e2e:when-it-fails` | did anything appear **in its place**? |

The second question is the product's own stated posture — *no quiet corners*.
A press that goes nowhere and says nothing is the quietest corner there is.

## The source pre-pass

`Home.tsx` holds **65 `.catch` handlers. Ten mention a channel that speaks;
55 do not.**

That headline number is not itself a finding, and reporting it as one would
have been the easy mistake. Most of the 55 are **reads** — a background load
whose empty fallback is honest, like `loadInspirations(p.id).catch(() => [])`.
An empty field after a failed fetch is not a lie.

The findings are the **acts**: a person pressed something, and the handler
does nothing a person can see. Sorting the 55 that way put the room's
maintenance verbs at the top, because their handlers share a shape that is
worse than silence:

```ts
.catch(() => setLeaving(null))     // leaveThisGroup
.catch(() => setClosing(null))     // closeThisGroup
.catch(() => setRemoving(null))    // removeMember
```

`leaving` / `closing` / `removing` hold the id of the thing whose **confirm is
armed**. Setting them to `null` closes the confirm. So the failure path and
the cancel path are the same gesture: the person presses the yes, the panel
folds back to the plain word, and the room is still there — with nothing
anywhere to say which of those two things just happened.

## What the browser measured

Six acts, each pressed against a 500 on the one route it rests on. Three of
them are **controls** — acts with a written failure line — and they are not
optional: if a control reads SILENT the instrument is broken, and the run
aborts rather than printing a screenful of false findings.

### Before

```
keep          SPEAKS     "That didn't keep. The words are still here — the server said no (500)…"
forget        SPEAKS     "That didn't go through — it is still here."
make-room     SPEAKS     "That group could not be made. Try another name."
rename-room   SILENT
leave-room    MURMURS    "leave this room"
close-room    MURMURS    "close this room"
```

- **rename — SILENT.** Not "quiet". The visible text of the page was
  **byte-identical** before and after the press. Clearing `busy` was the whole
  of what happened, and `busy` is invisible on a request that fails in under a
  second.
- **leave / close — MURMURS.** The only new line on screen is the verb the
  confirm collapsed back into. That is the finding from the source pre-pass,
  reproduced in a browser: the failure renders as a successful cancel.

### After

```
keep          SPEAKS     "That didn't keep. The words are still here — the server said no (500)…"
forget        SPEAKS     "That didn't go through — it is still here."
make-room     SPEAKS     "That room could not be made. Try another name."
rename-room   SPEAKS     "That name did not stick — the server said no (500)…"
leave-room    SPEAKS     "You are still in this room — the server said no (500)…"
close-room    SPEAKS     "That room is still open — the server said no (500)…"
```

`removeMember` got the same treatment without being walked — a second member
is a second account and an invite round trip, which this walk does not do. It
is fixed anyway: it is the same handler shape as the three that *were*
measured, written by the same hand on the same day, and leaving it silent on
the strength of not having been looked at is how the other three got this way.

## What the product was NOT doing wrong

Worth stating, because an audit that only reports faults is not a
measurement. **No act took the thing off screen that the server had refused.**
The `LIES` column — the world disagreeing with the archive — came back empty
across all six. `closeThisGroup` and `removeMember` are deliberately
server-first, and their own comment says why: *"the light must not go out
until the database has agreed."* That held.

### The instrument's own false finding

The first run reported `rename-room` as **SILENT + LIES** — the room's name
gone from screen though the server refused. It had not gone anywhere.
`innerText` respects `text-transform`, the label register uppercases every
wall's name, and the check was looking for `rename me 631299` on a screen
showing `RENAME ME 631299`.

The finding was probed before it was acted on, which is the only reason a
fabricated bug did not get a fix written for it. It is recorded here because
the next person to read this file should trust the table above exactly as far
as the probe that produced each row.

## Three things this walk found by side effect

1. **Every failure sentence in the product had a stray full stop.** Callers
   write finished sentences — `"That was not saved."` — because that is what
   renders when the error is not an `ApiError`. `whyFailed` then appended
   ` — the server said no (500): …`, giving
   *"That was not saved. — the server said no (500)"*. Nothing had ever put
   six of these side by side before. `whyFailed` now trims the stop.

2. **Eight pieces of live copy still said `group`.** Two were sentences handed
   to a function — `failed("That group could not be made…")`. Six were the
   `ApiError` messages in `lib/api/groups.ts`, which reach a person by the
   least obvious road in the product: `whyFailed` interpolates `err.message`
   onto the screen. The failure-path walk printed one verbatim, which is how
   they were found.

3. **`copy.test.ts` could not have caught any of them.** It read JSX text
   nodes and the message catalogue; all eight sat between the two. It now has
   a third channel — any string literal that reads as a sentence (a capital,
   three or more words, no interpolation), in `.ts` as well as `.tsx`, because
   that is where six of the eight were. The check was sabotaged before it was
   trusted.

## Three kinds of failure, not one

The first pass broke every route with a clean **500**, deliberately: it is the
case the client has the most excuse for handling well, since the promise
rejects with an `ApiError` carrying a status that `whyFailed` already knows
how to say. An act silent against a 500 will certainly be silent against
anything worse.

Having fixed those, the two worse shapes were worth running — and each found
something a 500 could not.

### `--kind drop` — the connection dies

All six spoke. But they spoke in **two different voices**:

```
close-room   "That room is still open — the server could not be reached."
rename-room  "That name did not stick — Failed to fetch"
```

`Failed to fetch` is Chrome's words, on a person's screen, under exactly the
condition a person is least able to interpret them.

The cause is one line. `http.ts` has three `fetch` calls: `getJson` and
`requestVoid` each wrap theirs in a try/catch that rethrows as
`ApiError { status: 0 }` — the thing `whyFailed` reads to say *"the server
could not be reached"*. **`writeJson` did not.** So a `TypeError` walked
through it into `whyFailed`'s plain-`Error` branch.

`writeJson` is every POST and PATCH in the product: keeping a memory, renaming
a room, leaving one, proposing a change, issuing a key. All of them leaked the
browser's internals whenever the network dropped. It is wrapped now, and the
six read with one voice.

The odd one out was the *correct* one, which is why this needed six acts side
by side to see at all.

### `--kind 401` — the session expired between opening the surface and pressing

All six spoke, and none showed a false success. But two of them **said the
wrong thing**:

> That room could not be made. **Try another name.**

A person whose session has expired is being sent to think up a different name
— advice that cannot work, about a problem they do not have. `submitGroup`
wrote one sentence for every failure alike. It goes through `whyFailed` now,
so the server gets to disagree with the guess; the fallback still says
`Try another name`, because a name collision *is* the likely cause of a 409.

**This is a limit of the instrument, and worth naming.** `SPEAKS` means a new
line appeared that names a failure. It cannot tell a *correct* sentence from a
confidently misleading one. This finding came from reading the printed output,
not from the verdict column — which is why the walk prints every sentence it
found rather than only a tally.

## The door, and an offline start

Both were on the "still unmeasured" list below. Both are measured now, and one
of them was the worst finding of the whole failure-path audit — not because
the product said nothing, but because it said something **false**.

### A 409 that needs no sabotage

Signing up with an address already registered is a real 409
(`auth-password.ts`), reachable by signing up twice. The door shows the
server's own sentence, verbatim:

> An account with this email already exists

No defect. Recorded because it is the most common failure on the first
surface and it behaves.

### An offline start says you are signed out

Kill every `/api/` request and reload as a signed-in person:

```
url:      /login
says:     "Welcome back."
          "Sign in to return to what you kept."
```

Restore the network, reload, and they are straight back in. **Nothing was ever
wrong with the account.** The product asserted a fact about their session that
it had no way of knowing, in the one situation where a person is already
inclined to fear their archive is gone.

The cause is in `auth-context`'s hydration: any failure of `/auth/me` drops
the cached viewer. That is **right and stays right** — a cache is a display
hint, never proof of a session, and rendering protected routes off stale
localStorage is the one mistake this must never make. `isAuthenticated` is
untouched by the fix and `RequireAuth` still sends the visitor to the door.

What changed is only what the door then says. `http.ts` already distinguishes
the two cases — a 401 is an answer, `ApiError { status: 0 }` means the
question was never asked — and the context now carries that as
`serverUnreachable`, which the door reads to choose its words and nothing
reads to decide access.

```
"Welcome back."
"Sign in to return to what you kept."
"We couldn't reach the server. Check your connection and try again."   ← new
```

Verified three ways: the banner appears with the network dead; the session
survives and the world returns when it comes back; and a visitor who was never
signed in, on a healthy network, sees no banner.

### A regression this audit caused, and caught

Pressing the door's submit with the network dead said:

> Login failed: network unreachable

The API client's voice, on the product's first surface — and the catalogue has
had `loginNetworkError` ("We couldn't reach the server. Check your connection
and try again.") for exactly this all along.

**That was this audit's own doing.** Before `writeJson` was wrapped earlier
today, a dead network on login threw a raw `TypeError`, which fell to the
`else` branch and rendered the product's own sentence. Wrapping it — the fix
that stopped the world showing people Chrome's `Failed to fetch` — turned that
into an `ApiError { status: 0 }`, which no longer matched `else` and fell
through to `err.message`.

One fix, two surfaces, opposite effects: the world gained a voice and the door
lost one. Both forms now branch on `status === 0` explicitly.

The lesson is narrower than "test everything": **a change to a shared error
path is a change to every screen that reads it**, and the screens that already
handled the case are the ones that quietly get worse.

### The first measurement was wrong

The first pass reported the door as SILENT — pressing sign in with a dead
network produced nothing at all. It was `page.locator("button", { hasText:
/^sign in$/i }).first()`, and the first match is the **tab**, not the submit.
The tab does nothing when you are already on it.

Caught by noticing that the pressable list held two "Sign in" entries. Had it
gone unnoticed, this audit would have reported a silent door and gone looking
for a bug in a handler that was working correctly the whole time.

## The other two real 409s, and the act behind them

Both were on the unmeasured list. Both **behave**, and reaching the second one
turned up an act that does not.

### A handle already taken

`PATCH /api/auth/me` refuses a duplicate public handle with a 409 carrying
field-level `details`. Two accounts, the second claiming the first's handle:

> That public handle is already taken

Shown verbatim. No defect. (The field is behind a `make a public page` button
on `/profile` — invisible until pressed, which is why the first attempt to
reach it timed out on an element that exists.)

### An agent past its key limit

`POST /api/profiles/:id/keys` refuses past `MAX_KEYS_PER_AGENT`. Its handler
already routes through `whyFailed` — `"That key was not issued."` — so the
server's sentence reaches the person the same way the signup 409's does.

### But giving an agent a wall said nothing at all

Reaching the agent surface meant walking `make-agent`, which the source
pre-pass had flagged and no walk had ever pressed. Measured: **SILENT.**

```ts
.catch(() => setAgentName(null))
```

`agentName` is not a busy flag — it is the form's open/closed state. Clearing
it **closes the dialog**. So a refusal and pressing `not now` were the same
gesture: the form folded, no wall appeared, and nothing said which had
happened. The room verbs' collapsing confirm, in the other half of the same
dialog.

Its sibling one row up — `submitGroup`, reached by choosing `a room` instead
of `an agent` — has carried an `error` on its form state all along. The two
halves of one dialog, written to different standards.

```
make-agent   SILENT  →  SPEAKS
  "That agent has no wall yet — the server said no (500): …"
```

The form now stays open and keeps the typed name, because the one recovery
available is pressing it again and that used to require re-opening a dialog
that had closed for no stated reason.

**Seven acts, three failure kinds, twenty-one readings: all speak.**

## What is still unmeasured

Named so the next pass starts from a list rather than from a fresh reading:

- **The top-of-mind acts** — `holdLead`, `dropLead`, `restoreLead`,
  `entrustLead`. `holdLead` is the interesting one: it shows a "pinned"
  receipt, then silently un-pins on failure, so the product asserts something
  and then quietly retracts it. Not walked because reaching a board needs
  signals, which need generation.
- **`sendProposal`, `answerProposal`, `acceptJoin`, `copyInvite`,
  `makeAgent`, `sayVerdict`, `restoreFromAntechamber`** — all acts, all
  currently silent on failure by the source reading.
- **`offlineRef`'s early returns.** An offline START is measured above, but
  the world also has a `goOffline` fixture path, and several handlers return
  early on `offlineRef.current` before any request is made. What those say, if
  anything, is still unasked.
- **`createProfile`'s own cap.** The server "caps how many an account may
  hold", so there is a third 409 behind `make-agent` that this walk provoked
  with a 500 rather than by hitting the cap. The handler is the same either
  way; the server's sentence is not.
