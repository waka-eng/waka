# Usability audit — 2026-08-26

Audit **A6** of `docs/goals/one-product-one-system.md`. Its end state: *a
Nielsen heuristic pass over every surface and a WCAG 2.2 AA pass, both written
down as ranked findings with severity, and everything in scope fixed.*

**This is the part that had not been done.** The WCAG half was covered inside
A5 and by `e2e:usability`; the heuristic pass had never been run, and the
register said so. It was reported as met anyway in one status message. It was
not.

## Method

Nielsen's ten heuristics, and WCAG 2.2 AA. Severity on Nielsen's own scale:
**4** catastrophic (must fix), **3** major, **2** minor, **1** cosmetic.

The founder linked a skill at `mcpmarket.com/tools/skills/user-experience-audit`.
That host is blocked by this environment's egress proxy (`EGRESS_BLOCKED`), so
its methodology was not read and is not what is being used. Claiming a method
that was not used would make every finding here unverifiable.

**Thirteen surfaces walked, with the DOM captured for each:** the door on both
tabs and after a failed sign-in; the world empty, just after keeping, and with
three kept; the mouth at rest, open and typed-into; the timeline; the settings
sheet; a memory open; the account page; the welcome. The canvas itself is out
of scope by founder decision; the chrome is not.

## Findings

### F1 — severity 4 — The settings sheet offered six doors to deleted screens

`capture · inspirations · signals · top of mind · rooms · principles`, still
listed in the account sheet after the flat screens and all eleven of their
routes were deleted. Pressing one closed the sheet and dropped you back in the
world with no message — the same thing the product does for an address that
never existed. Six controls that look like doors and are not.

The comment above them had set its own expiry: *"still scaffolding (they go
when the world can do everything they do)"*. The world can, as of that
deletion. They survived because the deletion swept routes and stylesheets and
never swept the things **pointing at** them.

*H1 visibility of system status, H3 user control, H5 error prevention.*
**Fixed** — removed, with the orphaned style that dressed them.

### F2 — severity 4 — There is no password recovery anywhere in the product

`auth-password.ts` has exactly two handlers: `signup` and `login`. No reset, no
recovery, no route in the API and no link on the door. A person who forgets a
password is permanently locked out of everything they kept — on a door whose
own words are *"Sign in to return to what you kept."* The failure message read
`Incorrect email or password.` and stopped there, so they would go looking for
a reset link that does not exist.

*H9 help users recognise, diagnose and recover from errors.*

**Partly fixed, and the rest is stated rather than hidden.** What is true is
that `auth-google.ts` links an existing account by **verified** email — and
refuses to link an unverified claim — so *Continue with Google* on the same
address really does open the same archive. The door now says so under the
refusal, together with the plain fact that WAKA cannot reset a password yet.

**What is left needs a decision that is not a code change:** an email-based
reset needs mail sending this environment cannot provision, and the wording of
a lockout policy is the founder's. Recorded here rather than left as a quiet
corner, since "there is no way to do this" is exactly what a quiet corner
hides.

### F3 — severity 3 — A principle's verbs ignored whose sentence it was

`schema-principles.ts` records `origin`: `minted` by the nightly generation, or
`declared` in the owner's own words. The world offered **both** `not mine` and
a hard `remove` on every principle regardless — so each was exactly backwards.
A sentence you wrote yourself was offered `not mine`, which is not a thing a
person can coherently say about their own words. A sentence the machine
concluded was offered a hard delete — the flat screens' administrative
affordance, and precisely the one this project refused to migrate for signals,
on the grounds that the world answers a wrong claim with a counted stance and
that *fading never deletes*.

*H2 match between system and the real world, H5 error prevention.*
**Fixed** — you **answer** what the machine claims (`not mine`), and you
**withdraw** what you said yourself. Same ruling, other noun.

### F4 — severity 3 — The product defines none of its own vocabulary

`inspiration`, `signal`, `top of mind`, `philosophies & values`, `the
antechamber`, `wall`, `room`, `how it reads you` — coined words carrying the
whole model, and there is no glossary, tooltip or first-run explanation
anywhere in the product. `the antechamber` in particular cannot be guessed
from its name. A person's only route to the meaning is to press things and
infer.

*H2 match between system and the real world, H10 help and documentation.*

**Open, and deliberately not fixed here.** Every obvious remedy — a tooltip
layer, a glossary panel, a first-run tour — adds a surface to a product whose
whole claim is that it holds less, and picking which one is a design decision
rather than a defect repair. The recommendation is the smallest of them: let
the eyebrow labels the world already prints say what they mean when asked,
reusing the card that already exists, rather than adding a new screen.

### F5 — severity 1 — Every unknown address silently becomes the world

`/nonsense-xyz` behaves exactly like `/inspirations` and exactly like a typo:
signed in, all three land in the world; signed out, all three land on the door.
The product never says an address is wrong.

This is the honest answer to *"why do we need to keep old bookmarks alive?"* —
**we are not keeping them alive.** There is no redirect rule for any retired
route and nothing to maintain. What there is instead is a catch-all that
swallows every wrong address in silence.

*H1 visibility of system status, H9 error recovery.*
**Open.** Low severity: landing in the world is a safe place to land, and it
is the right destination for an old bookmark. The cost is only that a typo and
a real address are indistinguishable.

## Checked and clean

- **H1 status** — the empty world says *Forming — nothing adopted yet*; keeping
  is acknowledged; the count reads *3 INSPIRATIONS*; the timeline word reads
  *NOW*; the board announces *YOUR TOP OF MIND WAS WRITTEN FOR THE FIRST TIME*.
  The slowest interaction was measured: pressing `reflect` says **SAVED** and
  puts the answer box on screen within 400ms — there is no blind wait.
- **H3 control and freedom** — every modal closes; both destructive paths ask
  first.
- **H4 consistency** — one label register in one layer, one modal surface with
  four wearers, both gated.
- **H5 error prevention** — deleting an account requires typing a confirmation;
  letting a memory go asks before it acts.
- **H6 recognition** — the board's four acts rest at 0.72 opacity and brighten
  under the pointer; they are not hidden (an earlier bug that hid them
  entirely is fixed and gated by `e2e:journeys`).
- **WCAG 2.2 AA** — target size 24/44, no field under 16px, contrast measured
  against painted colours, focus visible, every control named. Held by
  `e2e:phone`, `e2e:usability`, `contrast.test.ts` and `e2e:journeys`.
