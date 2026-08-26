# The failure-path audit — what the product says when a press does not go through

**Date:** 2026-08-26
**Instrument:** `pnpm e2e:when-it-fails` (`tools/e2e/when-it-fails.ts`)

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
- **Failure kinds other than a clean 500.** The walk uses a 500 deliberately:
  it is the case the client has the most excuse for handling well, since the
  promise rejects with a status `whyFailed` already knows how to say. A
  dropped connection, a 401 mid-session and an offline start are each a
  different shape and none is covered.
