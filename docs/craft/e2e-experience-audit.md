# End-to-end experience audit

Run 2026-08-22 against `dev` @ `c6a64b2`, on a full local stack — real Postgres,
real API, the production web build, seeded demo account, driven in Chromium.
Scope: the product journey a person actually walks, plus the terminal/MCP
journey from `waka-eng/waka-mcp` @ `68170a8`.

This is a register of what the experience does, not a plan. Nothing here is a
recommendation about what WAKA should *be* — six redesigns have been rejected
for jumping to a position, and this document deliberately stops at "here is
what happens, here is the evidence, here is where it lives".

---

## Method, and what it can and cannot support

The stack was brought up the way `README.md` says to bring it up:
Postgres 16 local, `pnpm db:migrate`, `pnpm demo:seed`, `pnpm dev:local`
serving the **production web build** on `:3010`. Every observation below was
made through a real browser against that stack, not read out of source.

**What this can support.** Anything about first run, sign-in, the world, the
six flat surfaces, capture, mobile layout, keyboard and assistive-technology
surface, and the terminal consent flow. These were exercised.

**What it cannot support.** There was no `GEMINI_API_KEY`. So nothing that
depends on a model call ran for real: signal derivation, top-of-mind
synthesis, principle minting, link enrichment, image description. Seeded rows
stood in for their output. Two of the three MCP live-gate failures below are
this and only this, and are marked as such. Google OAuth was not configured,
so that sign-in path is untested. No room had a second member, so the sharing
boundary was read rather than driven.

Each finding carries how it was established:

| Tag | Meaning |
|---|---|
| **[driven]** | Observed in a browser against the running stack, reproduced at least twice. |
| **[measured]** | A number taken from the running page (pixels, contrast ratio, sampled colour). |
| **[static]** | Read from source. Reproducible without running anything. |

---

## Summary

| # | Severity | Finding |
|---|---|---|
| 1 | **Blocking** | The world is a blank black screen whenever either font CDN is unreachable — **fixed 2026-08-22**; `SurfaceBoundary` + a narrow preload recovery, gated by `e2e:first-paint` |
| 2 | **Blocking** | `pnpm demo:seed` — the documented way in — fails against current migrations — **fixed 2026-08-22** |
| 3 | **Major** | A declared principle is silently filed as a note when the model call fails — **fixed 2026-08-22**; `503 retryable`, and nothing written. There were *two* silent conversions, and a test had encoded one as intent |
| 4 | **Major** | The product is two themes: near-black world, near-white surfaces — **resolved 2026-08-24**; the crossing that caused it is gone, and removing it had stranded all six flat screens with no way back |
| 5 | **Major** | Sign-in's primary action is the weakest thing on the screen; no password recovery exists — **rank fixed 2026-08-24** (648px² → 26,304px², and asked first); recovery deferred by decision, no mail provider |
| 6 | **Moderate** | The "other screens" menu opens on top of the sentence it obscures — **fixed 2026-08-23**; the control is gone and its contents live in the world |
| 7 | **Moderate** | Keeping something — the core act — confirms almost invisibly — **fixed in the world 2026-08-23**; the orb now arrives, which is the confirmation the design always intended |
| 8 | **Moderate** | 21–22 touch targets per surface under 44px, destructive ones at 20px — **fixed 2026-08-24**; `/top-of-mind` went 11-of-20 under 44px to 0-of-20 |
| 9 | **Moderate** | The world is one unlabelled canvas to assistive technology — **out of scope by founder decision** |
| 10 | **Minor** | Three product nouns on the sign-in screen — **fixed 2026-08-24** |
| 11 | **Minor** | `/signals` prints a raw confidence percentage with nothing to read it against — **fixed 2026-08-24**; `42%` → `steady` |
| 12 | **Minor** | The demo fixture describes a signal state the product forbids creating — **fixed 2026-08-24**; a third evidence row, not a demotion |
| 13 | **Minor** | The consent page has no decline control — **out of scope**; real but small, and it resolves through the client's timeout |
| 14 | **Major** | Nobody knows the world can be moved through — user feedback; **fixed 2026-08-24**, three separate invisible failures |
| 15 | **Major** | The first memory a person ever keeps does not appear until reload — **fixed 2026-08-23**; a clock-skew bug that silently dropped the newest orb on *every* keep |
| 16 | **Blocking (mobile)** | `/signals` renders as a column of single letters on a phone — found and **fixed 2026-08-24** |
| 17 | **Blocking** | Near-white on near-white at 1.15:1 — every signal sentence, and every surface's page title, by two different roads — found and **fixed 2026-08-24** |
| 18 | **Major** | The four entry actions on the top-of-mind headline were unreachable on every desktop — finding 14's bug in a second place, missed by its own fix — found and **fixed 2026-08-24** |

**Where this stands: 16 of 18 addressed, 2 out of scope by decision, 1 part
deferred.** Everything above is fixed except finding 9 and finding 13, which
are out of scope by decision, and the password-recovery half of finding 5,
which waits on a mail provider and is the only item here that can lock a real
person out of their own memory.

**The pattern across all eighteen.** Not one of these threw an exception,
failed an assertion, or turned a suite red. A blank world, a keep that never
appeared, a hover that could never fire, six screens you could reach and not
leave, a page of near-white text on near-white paper — every one of them
shipped past a fully green build. Three of them (16, 17 and 18) were found
only because someone was measuring something else at the time — none was
looked for, which is the strongest thing this table says about how much is
left unmeasured. The gates added along the way exist to make that class of
failure loud: `e2e:first-paint` and `e2e:journeys` now run in CI, and each
journey is put through its own sabotage and must fail, because a check that
cannot fail is indistinguishable from one that is passing.

Working well, and worth not breaking: Korean coverage is genuinely complete;
capture round-trips correctly; no surface overflows horizontally on a phone;
the permission matrix holds under the MCP live gate.

**One line of that summary was wrong and is corrected below.** It read
"measured text contrast passes on every surface tested". Finding 17 is a
1.15:1 failure on the sentences that are the whole content of `/signals` — the
pass sampled labelled text and never measured the field carrying the claim.

---

## 1. The world is a blank black screen whenever either font CDN is unreachable

**Blocking.** [driven] [static]

Sign in successfully, and `/` renders **nothing**: `#root` has zero children,
zero canvases, zero characters of text. Not a spinner, not an error — the
near-black page background and nothing on it. The flat surfaces
(`/inspirations`, `/signals`, …) keep working, so the account is fine and the
session is fine; only the product's primary surface is gone.

**Reproduced by A/B, twice each:**

| External font hosts | `#root` children | canvases | thrown |
|---|---|---|---|
| reachable | 1 | 1 | — |
| `fonts.googleapis.com` blocked | 0 | 0 | `Unable to preload CSS for /assets/Home-*.css` |
| `cdn.jsdelivr.net` blocked | 0 | 0 | `Unable to preload CSS for /assets/Home-*.css` |

Blocking **either** host alone is sufficient. That matters: these are two
independent third parties, and the page hard-depends on both.

The error message is misleading and cost real time here. `Home-*.css` is
served fine — `200`, correct `content-type`, and the link element reports
`sheet: true`, meaning the browser parsed and applied it. The stylesheet the
message names is not the stylesheet that failed.

**Where it lives.**

- `packages/web/index.html:7-12,37-42` — three render-blocking stylesheets
  across two third-party hosts (`fonts.googleapis.com` twice,
  `cdn.jsdelivr.net` once), plus `preconnect` to a third (`fonts.gstatic.com`).
- `packages/web/src/main.tsx:98-115` — `ProtectedHome` wraps the lazy
  `HomePage` in `<Suspense fallback={null}>`.
- No `ErrorBoundary`, `componentDidCatch`, or `getDerivedStateFromError`
  exists anywhere in `packages/web/src`. [static]
- No `vite:preloadError` listener exists either — and Vite dispatches exactly
  that event, cancellable, before rethrowing. [static]

**Why it ends in a blank rather than a broken page.** The lazy import rejects;
`Suspense` has nothing to show for a rejection and `fallback={null}` means
nothing is what it shows; no boundary catches it. The result is
indistinguishable from "still loading", forever. `main.tsx:109-110` explains
the null fallback as a deliberate choice — "the layout's own first frame IS
its loading state" — which is right for the loading case and leaves the
failure case with no picture at all.

**Who this reaches.** Anyone whose network does not resolve Google Fonts or
jsDelivr: a good deal of mainland China, corporate networks that block CDNs,
strict tracking blockers, and everyone during a CDN incident. They can sign in
and then land on a void.

---

## 2. `pnpm demo:seed` fails against current migrations

**Blocking.** [driven] — **fixed on this branch.**

`README.md` offers `pnpm demo:seed` as the way to get "a realistic account to
look at". Run against a freshly migrated database it aborted:

```
signal … cannot be promoted to active with 0 evidence (needs 3) — see docs/generation.md
```

The seeder inserted each signal with its final status and *then* inserted the
evidence. `drizzle/migrations/0007_promotion_not_residence.sql` fires on the
transition into `active` and counts the evidence standing at that instant —
zero. The migration's own comment says the ordering it blocks is not one the
product ever performs: "a signal is promoted after its evidence is inserted,
never in the same statement". Derivation obeys that. The seeder did not.

Also worth noting for how this went unnoticed: `tools/seed-demo.ts` is not
covered by any suite, so nothing failed when 0007 landed.

**Fixed here** by making the seeder use the product's own order — insert
`emerging`, insert evidence, then promote — and by restating the promotion bar
as a named constant next to the check. See finding 12 for the data problem the
fix then exposed.

---

## 3. A declared principle is silently filed as a note when the model call fails

**Major.** [driven] [static]

`POST /api/principles` returned `created: "inspiration"` for a statement the
MCP live gate expects to qualify as a principle. The cause is one line:

```ts
// packages/api/src/routes/principles.ts:260-265
const route = await provider
  .routeDeclaration({ … })
  .catch(() => ({ route: "inspiration" as const, type: "maxim" as const }));
```

Every failure of the model provider — missing key, outage, rate limit,
timeout, malformed response — is caught and converted into the same outcome as
a considered rejection. The statement is written to `inspirations` and `201`
is returned.

This collides with a deliberate product rule. `README.md`: a declaration that
fails the tests "is kept with your inspirations, and **no refusal is ever
shown**." The route comment says the same — "no verdict travels back with the
response". That silence is defensible when the judge actually judged. It is
not defensible when the judge never ran: the person told WAKA how they choose,
WAKA said nothing, and their words became a note. There is no state anywhere
that distinguishes the two, so no later screen can ever tell them apart
either.

The design intent and the failure mode need separating — the user need not see
a *refusal*, but "we could not consider this right now" is a different
sentence from silence, and only the second one is currently sayable.

---

## 4. The product is two themes

**Major.** [measured]

Average sampled background, from the screenshots of the running build:

| Surface | avg RGB | |
|---|---|---|
| `/login` | `(14, 16, 21)` | near-black |
| `/` (the world) | `(10, 12, 15)` | near-black |
| `/profile` | `(10, 12, 17)` | near-black |
| `/capture` | `(251, 251, 250)` | near-white |
| `/signals` | `(251, 251, 250)` | near-white |
| `/rooms` | `(250, 250, 249)` | near-white |

Opening the `≡` menu in the world and choosing SIGNALS is a full-screen
black-to-white flash, and coming back is the reverse. In a session, a person
crosses this repeatedly.

This also contradicts the map. `docs/architecture.md` says the flat screens
are given "the world's palette without its geometry" by `chrome.css`.
`/profile` and `/login` do exactly that. The six Surface routes do not — they
are a different palette, not a flatter version of the same one. Whichever way
this is meant to resolve, the doc and the build currently disagree.

### Re-measured 2026-08-24, after the menu was removed — **resolved, and not the way this expected**

Two of the three claims above no longer hold, and a worse one took their place.

**The repeated crossing is gone.** Sampled from the running build: the world
carries **zero** links into any of the six Surface routes. The `≡` menu was
the only door and Phase 1 removed it. Nothing in the world flashes to white
any more, because nothing in the world goes there.

**But the exit went with the door.** The menu opened *from* the world, so it
was also the way home — and the Surface footer never had one of its own. Every
one of the six routes could be arrived at (a bookmark, an old link, the
terminal flow) and **not left**, except by the browser's back button or the URL
bar. That is a strictly worse defect than a palette flash, it was created by
fixing finding 6, and nothing caught it. Fixed: `← the world` now sits first in
the surface footer, set off from the view-switching verbs beside it, and
`journeys:parking-lot` walks all six.

**The palette split stands, and is now declared rather than denied.** Sampled
averages are unchanged — world `(6,8,13)`, the six Surface routes `(247–252)`.
The doc was the thing that was wrong: these routes are a parking lot in a paper
register, holding what has not yet been designed into the world, and repainting
1,800 lines of measured light-ground type and contrast to match a world nobody
crosses into from them would be a large investment in surfaces the founder has
said should be deprecated by migration. `docs/architecture.md` now says what is
true, in its own diff. If the split is ever meant to close, it closes by those
screens *leaving*, not by being repainted.

---

## 5. Sign-in's primary action is the weakest thing on the screen

**Major.** [driven] [measured]

On `/login`, ranked by visual weight: a full-width white pill (CONTINUE WITH
GOOGLE), then the two tab labels, then the field labels — and last, at
**40×16px**, lowercase, underlined, bottom-left, the actual submit button for
the form the user just filled in. `chrome.css:1019-1025` sets it to 14px and
`text-transform: lowercase`, styling the form's completion as a footnote.

Below the 44px minimum in both axes, and below it by a lot in height.

**No password recovery exists.** [driven] Neither tab offers "forgot
password", and `/login` contains no `forgot` or `reset` text at all. For an
email-and-password product this is a terminal state: a returning user who has
forgotten their password has nothing to click. Everything else on this list is
friction; this one is a locked door.

Minor, same screen: "New to WAKA? Create account." sits centred beneath a
left-aligned form and duplicates the CREATE ACCOUNT tab six inches above it.

### Fixed 2026-08-24 — except the recovery, which is deferred by decision

**The rank is inverted.** The submit is now the largest control on the screen
— 548×48, against Google's 548×44 — and it comes *before* the alternative
rather than after it. It did not get there by shouting: the page keeps one
uppercase register and it belongs to eyebrows, so the weight comes from the
two channels a lowercase word can still use, **ground and footprint**. Google
moved below an OR divider, which is where an alternative belongs, and is
otherwise untouched — a recoloured Google button is a phishing signal.

| control | before | after |
|---|---|---|
| the form's submit | 40×16 = **648px²** | 548×48 = **26,304px²** |
| CONTINUE WITH GOOGLE | 548×44 = 24,112px², **first** | 24,112px², **last** |

**The duplicate prompt is gone.** "New to WAKA? Create account." was a second
copy of the CREATE ACCOUNT tab on the same card, centred under a left-aligned
form. The tab is the control.

**Password recovery is still missing, and is still the one locked door.**
Deferred by decision pending a mail provider — no route, no token table, no
transport, and inventing one without a way to send the mail would be worse
than the gap. The lockout copy that pointed at the non-existent feature was
fixed on 2026-08-22. When a provider is chosen this is the first thing built.

Gated by `journeys:doorway`, whose sabotage restores the footnote treatment
exactly: under it the submit measures 737px² and is outranked by both tabs and
the Google pill, which is the shipped defect reproduced.

---

## 6. The "other screens" menu opens on top of the sentence it obscures

**Moderate.** [driven]

The `≡` control at top centre of the world opens a panel listing CAPTURE,
INSPIRATIONS, SIGNALS, TOP OF MIND, ROOMS, PRINCIPLES. The panel is
semi-transparent and lands directly over the top-of-mind headline, so both
become unreadable at once — the headline shows through the menu items and the
menu items sit on 48px display type. The one sentence the world exists to
present is the thing the navigation covers.

The control itself is built correctly — `aria-expanded`, `aria-haspopup`,
`aria-label="Other screens"`, with the glyph `aria-hidden`
(`Home.tsx:9661-9674`). The trigger is an 11×17px bare `≡` with no other
affordance, which is small, but the code above it already says what it is and
why: a self-described placeholder, to be deleted "when `/principles` has a
home in the world". The overlap is the part that reads as unintended.

---

## 7. Keeping something confirms almost invisibly

**Moderate.** [driven]

Capture works: typing into `/capture` and pressing `⌘↵` returns
`201 POST /api/inspirations`, the text appears in `/inspirations`, and the nav
count increments. The mechanism is sound.

What the person sees is the word **"kept"** in small low-contrast text below
the box, with no motion and no change to the composition. For the single act
the whole product is built around, the acknowledgement is easy to miss
entirely — and the field, where that memory just became an orb, is not on
screen to show it landing.

---

## 8. Touch targets

**Moderate.** [measured] at 390×844, `isMobile`, touch enabled.

| Surface | controls under 44px |
|---|---|
| `/inspirations` | 21 |
| `/capture` | 21 |
| `/top-of-mind` | 22 |

The shape of it matters more than the count. **"take it down" measures 20×20px
and sits immediately beside "hold" at 21×21px** — a destructive control at
under half the minimum, adjacent to a non-destructive one, with no spacing
between them to absorb a mis-tap.

Mitigated, and worth crediting: an undo exists (`sf-undo` / `putEntryBack`,
`Surface.tsx:2243`), and `window.confirm` guards principle removal and room
close/leave (`Surface.tsx:333,501`). "Fading never deletes" is being honoured.
The ergonomics are the gap, not the safety net.

### Fixed 2026-08-24

The audit missed the two smallest controls in the product: the principle
arrows, at **11×20**, in the same row as REMOVE.

| | before | after |
|---|---|---|
| `take it down` / `hold` on a post-it | 21×21 and 22×22, **21px apart** | 44×44, **44px apart** |
| principle `↑` / `↓` | **11×20** | 44×44 |
| `read this again` | 18×18 | 44×44 |
| `← back` | 47×22 | 47×44 |
| the reading's provenance row | 22px tall | 44px tall |
| `your profile` / language in the you-menu | 33px and 18px tall | 44px |
| the shortest footer verb | 42px wide | 46px |
| `/top-of-mind` controls under 44px | **11 of 20** | **0 of 20** |

**The marks did not get bigger; the hands did.** Enlarging the glyphs would
turn a note's quiet footer into a toolbar, and these are meant to be found
rather than offered — so the button is 44×44 and the disc the eye reads is
still 22px, drawn inside it. Negative margins give the extra height back, so
no sheet reflows: the whole change is invisible until you try to press it.

**Spacing was half of it.** Two 44px targets whose centres are 21px apart are
*worse* than two small ones — they overlap, and the overlap belongs to
whichever paints last. At `gap: 0` the new boxes put their centres exactly
44px apart, which is the smallest distance at which they do not overlap. The
irreversible verb in the principles row gained real distance for the same
reason, keeping its quiet register: there is no red in Waka at rest.

**Two things were deliberately not changed.** `.sf-control` is 32px with the
reason written beside it, and its nearest neighbour measures 94px away — the
spacing clause covers it, and overriding a decision this repo made on purpose
to satisfy a round number would be worse than the gap. The full-width text
fields (29–37px tall) are likewise uncrowded. So the gate is **not** "44px
everywhere": it is a 24px floor on size, and a 44px floor on distance that
only 44px targets may cross. That is narrower than this goal originally
promised, and it is what the evidence supports.

Gated by `journeys:the-hand`, whose sabotage restores the 21px marks a pixel
apart: under it the run reports `hold (22x22) & take it down (22x22) 22px
apart`, which is this finding as it shipped. Its first version passed over six
empty screens and the `--negative` run said so in one word — *survived
sabotage; this journey is decoration* — so it now keeps a memory and declares
a principle before it walks, and fails outright if it finds no marks at all.

---

## 9. The world is one unlabelled canvas to assistive technology

**Moderate.** [driven]

Of the world: one `<canvas>` with `role: null`, `aria-label: null`, and no
fallback content; one `nav` landmark and no `main`; zero `aria-live` regions;
one `h1` (the top-of-mind sentence — correctly).

Everything the world *means* — every memory in the field, its aliveness, every
statement forming in the sky, whose wall you are on — is painted pixels with
no text equivalent. A screen reader gets the headline, a handful of buttons,
and silence where the product is.

The `aria-live` absence has a narrower, sharper consequence: nothing announces
the result of an action. "kept" (finding 7) is not announced, so a
non-sighted user gets neither the visual confirmation nor a spoken one.

Tab order is coherent and every control is reachable — this is not a
keyboard-trap situation. It is that the canvas is the content and the canvas
says nothing.

---

## 10. Three product nouns on the sign-in screen

**Minor.** [driven] [static]

`/login` shows the eyebrow "WAKA · Signals"
(`i18n/messages/en-US.json:191`), under a document title "WAKA —
Inspirations", above the line "Sign in to return to your inspirations."

`docs/architecture.md` is explicit that user-facing text says *inspiration*,
"because that is what the product calls itself", and that `signal` is a canon
layer name. The eyebrow uses a layer-2 word as branding on the one screen
every user sees before they know what either word means.


### Fixed 2026-08-24

The eyebrow is `WAKA`. The subtitle is "Sign in to return to what you kept" —
no canon layer name at the door, in either language. Checked by
`journeys:doorway`, which counts how many of `inspiration` / `signal` /
`top of mind` / `principle` appear in the login card and fails on more than
one. Run against the copy that shipped, it returns `["inspiration", "signal"]`
— the finding, reproduced.
---

## 11. `/signals` prints a raw confidence percentage

**Minor.** [driven]

A signal row reads: `3 behind it · 43% · still forming`. Nothing on the page
says what 43% is a percentage *of*, what a good one would be, or what changes
it. Two significant figures imply a precision the reader cannot act on.

Not a violation of "states render, numerals never" — that law is scoped to the
world, and the world does obey it ("TWO PATTERNS ARE FORMING", spelled out).
The flat screens are explicitly not the world. It is that this particular
numeral has no legend anywhere near it, while "3 behind it" and "still
forming" — beside it, in the same row — are both legible without one.


### Fixed 2026-08-24

`42%` was a quantity with no unit and no scale in sight — 42% of what, out of
what, good or bad — sitting between two things on the same line that were
already states in words. The law is that states render and numerals never, and
`docs/data-model.md` says what this number is: **confidence is the light.** In
the world that is literal. A flat surface has no light channel, so it says it
in a word.

| | |
|---|---|
| before | `3 behind it · 42% · still forming` |
| after | `3 behind it · steady · still forming` |

Three bands, cut where the formula has structure rather than at thirds
(`lib/confidence.ts` carries the arithmetic): **40** is just above where a
pattern lands the day it is born — three captures, no span, is about 42, which
is exactly the number that was on screen — and **70** is past what support
alone can buy, so nothing reaches `strong` without having recurred across time.
The words order themselves in plain English, which is the whole of what `42%`
failed to do.

Deliberately not merged with `status`: `emerging`/`active` is a threshold on a
count, this is how hard the pattern holds now, and `steady · still forming` is
two facts rather than a contradiction.

Two things came out of doing it. The rest of that line was hardcoded English
while the surface around it was localized, so one translated word would have
made it a mix — all of it speaks the reader's language now. And the count
needed `formatMessage` rather than `{n} {suffix}`: the suffix form renders
`3 개가 뒷받침` in Korean, where the counter has to attach and the word order
differs. It reads `근거 3개` now, verified in a browser in both languages.
---

## 12. The demo fixture describes a state the product forbids creating

**Minor.** [driven]

With finding 2 fixed, the seeder got further and hit a second problem in the
data itself. `personal-data-needs-a-volume-knob` in `tools/demo-seed-data.ts`
is declared `active` with **2** evidence rows; the promotion bar is 3.

Active-on-two is a state the product genuinely produces — `settleStrandedSignals`
leaves a locked signal standing when its footnotes are deleted, which is
`0007`'s whole argument. But it is only ever *arrived at*, never entered, and
the seed does not set `unsupported_at`, so it is not modelling a stranded
signal either. Seeding it directly would invent a history that never happened.

The seeder now warns by name and seeds it `emerging` rather than lying. The
data decision is open: give it a third evidence row, or declare it emerging.

### Decided 2026-08-24 — a third evidence row

Demoting it was the cheaper option and the wrong one: a top-of-mind card cites
this signal, so `emerging` left the demo standing on a claim its own rules say
is not a pattern yet.

Force-fitting one of the existing eight was equally wrong — the nearest,
Trello's card aging, is about neglect announcing itself, not about shareable
personal data, and reaching a count with filler is the same lie in a different
place.

So the pattern gets the case its own sentence was missing. It names a tension —
*"drawn to personal data made shareable, and suspicious of it the moment the
person cannot turn it down"* — and had only the two halves that are done **to**
you: Wrapped (delight) and the streak freeze (pressure). The third is Strava's
privacy zones, where the volume knob exists. Reseeded: **11 inspirations, 4
signals over 11 evidence links, and no warning.** The signal now reads
`3 behind it · steady` rather than `· still forming`.

---

## 13. The consent page has no decline control

**Minor.** [driven]

`GET /api/auth/cli/start` renders "Connect a terminal to WAKA", names the
device and account, offers a radio per profile, and one button: **Allow**.
Refusal is prose — "Close this tab to refuse."

It does resolve: `src/auth/login.ts:198-200` in `waka-mcp` sets a timeout, so
an abandoned tab eventually fails the CLI with an error rather than hanging
forever. So this is an ergonomic gap, not a trap. But the page is a consent
screen shown in response to something a terminal initiated, which is exactly
the situation where an explicit, immediate "No" is worth having — and it would
let the waiting process fail in a second instead of on a timeout.

Otherwise this page is the most carefully written surface in the product. It
names the asking device, states the 30-day lifetime, states that revocation
does not touch the browser session, and states the access difference between
an agent-bound and a human-bound credential — before the button, not after.

---

## 14. Nobody knows the world can be moved through

**Major.** [measured] — **fixed 2026-08-24.**

Not found by the audit. A real person, using the product, said they had no
idea they could go left, right, up or down.

They were right, and it was not one bug. It was three, and every one of them
was **invisible rather than wrong** — nothing threw, no count moved, and the
whole suite stayed green through all of it.

### Left and right: the signposts existed and had never once been drawn

The ways out are already designed and already built. Each margin carries the
neighbouring wall's name with a chevron (`‹ Demo Agent`) and, below it, the
offer to grow the axis that way (`Add an agent`, `Make a room`). All of them
rested at `opacity: 0`, revealed by:

```css
.jar-hq:hover .jar-edge, .jar-edge:focus-visible { opacity: 1; }
```

`.jar-hq` carries `pointer-events: none` — the world underneath it has to stay
reachable — and **an element that takes no pointer can never match `:hover`.**
So that selector had never fired, on any pointer device, in the whole life of
the file. The only thing keeping the signposts on screen anywhere was a
`@media (hover: none)` rule setting `0.7`, which is why they were visible on a
phone and invisible on every desktop there has ever been.

The affordance that teaches you the world is wider was itself gated behind
already knowing.

Measured at headquarters, 1440×900, pointer resting inside the world:

| signpost | opacity |
|---|---|
| `Make a room` | 0 |
| `Add an agent` | 0 |
| `‹ Demo Agent` | 0 |

### …and underneath that, one class name doing two jobs

Turning them on exposed the second bug immediately: `‹ DEMO AGENT` printed
straight through `ADD AN AGENT` at the left margin.

`home.css` held **two complete, conflicting `.jar-edge` definitions**, 280
lines apart, each with its own comment header claiming the name. One is a
*vertical rail hard against a margin* (`writing-mode: vertical-rl`,
`--l`/`--r` as anchors). The other is a *horizontal name placed from its
wall's own column* (`white-space: nowrap`, `max-width: 22ch`,
`--r: translateX(-100%)`). Whichever came second won, silently, property by
property. So:

- a way out inherited `writing-mode: vertical-rl` and became a 10px stripe;
- the right-hand one held its own inline `left` **and** the rail's
  `right: 10px`, was anchored twice, and stretched into a 110×25 flat box
  while its mirror image stayed a 10×83 vertical one.

Both read as layout bugs. Neither was. They were one name doing two jobs.

The horizontal signposts are now `.jar-way`, with `.jar-edge` left to the
rails, and the two things each margin carries are separated vertically —
travel at eye level beside the companion, the offer to extend the axis below
it.

### Up: the ground announced itself and the sky did not

The field has always had a peek row: memories elected to rise toward
headquarters so the bottom of the screen is never empty. The sky had no
equivalent, so the top edge was plain black.

Measured standing at headquarters on the demo account, canvas pixels:

| band | avg | max |
|---|---|---|
| top edge (0–12%) | **0.05** | 65 |
| bottom edge (88–100%) | **7.20** | 186 |

The ground announced itself **144× more loudly** than the sky. The sky's
centre is `minCam + 0.46·vh`, so its lowest statement rested about **340px
above the viewport** — there was nothing to see because there was nothing
there.

`Neb` now carries a `peekY`, `layoutSky` elects the lowest two statements per
wall, and `stepSky` eases them toward the seam against the same camera scalar
the field's `peekLift` uses — 1 where you stand, 0 once you are up in it.

**The first build of it looked completely broken and was working perfectly.**
The clouds were elected correctly and reached their `peekY` exactly, and the
top edge moved 0.05 → 0.07. `rasterNebula` bakes alpha as
`peak · (1−u)^2.4` under a mask that is already zero at the rim, so past about
half a radius there is no light left in the sprite. Hanging the clouds at
`0.62r` above the seam put the **entire on-screen band inside that dead
zone**. The depth is now `0.28r` and named, with that measurement in the
comment beside it, because the number is the whole fix and looks arbitrary
without it.

One more thing surfaced by the fix: at full lean, a statement's DOM sentence
was sliced mid-line by the viewport and printed under the chrome. The words
now fade as the cloud leans down and resolve as you climb — light is the only
thing that crosses the seam, and reading the sentence is what going up there
is for.

| band | before | after |
|---|---|---|
| top edge (0–12%) | 0.05 | **0.73** |
| top strip (0–6%) | — | **1.42** |

### Proven by

`tools/e2e/journeys.ts` gained `ways-out`, whose sabotage **is the original
bug** — `.jar-edge, .jar-way { opacity: 0 }` — rather than an invented one. It
asserts every signpost on screen is visible, that none of them overlap, that
any elected sky statement actually arrived near the seam, and that the lean
scalar reads 1 at headquarters even on an account with no statements to lean.
It says out loud when the sky half checked nothing, so a vacuous pass can
never read as a clean one. `FieldAudit` gained a `sky` block for the same
reason `provenanceCount` is in it: this is a promise whose failure looks
identical to a quiet screen.

Confirmed at 1440×900 and 390×844, and on the climb: the words resolve, and
the clouds return to their own arrangement as you rise.

**Still open on this finding:** the horizontal fix restores signposts that
were designed and built. It does not make the *neighbouring wall itself* peek
past the left and right edges the way the field peeks past the bottom, which
would be the world's own idiom rather than chrome. That is a larger change —
culling, physics, and the question of whose memories are whose — and is not
attempted here.

---

## 15. The first memory a person keeps does not appear until reload

**Major.** [driven] — **fixed 2026-08-23.**

Keeping the very first memory on a new account left the field empty. Reload
and it was there. It read as "the keep didn't work", which is the worst thing
the core act of the product can read as.

`assignHomes` filters `b.capturedMs <= TRef.current`. `TRef` starts at
`Date.now()` when the world mounts and is advanced only by scrubbing the dial
or by a client-stamped birth. The server's `createdAt` for the new capture
measured **+6ms ahead** of that. `inspirations` is a dependency of the sim
effect, so every keep tears the sim down and rebuilds it from the server's
timestamp — in the future of the dial, and therefore dropped.

It dropped the newest orb on **every** keep. It was only ever *visible* on the
first one, because 0-of-1 is an empty world and 49-of-50 is not.

The fix is one line, after the ball list is built:

```ts
for (const b of list) TRef.current = Math.max(TRef.current, b.capturedMs);
```

The dial cannot be standing before a memory it is being asked to show.

Proven by the `first-keep` journey: field light `0.06 → 1.57` without reload,
against `~1.95` after one.

---

## 16. `/signals` renders as a column of single letters on a phone

**Blocking, on mobile.** [measured] — found 2026-08-24, **fixed the same day.**

Not found by the original audit. Turned up while measuring touch targets.

At 390×844 every signal's sentence collapsed to **9px wide and 1,742px tall** —
the whole screen rendered as one letter per line, running down the page for
the length of the sentence, one signal after another. `/signals` was not
degraded on a phone; it was unreadable.

A signal row is a flex **row**: the machine's sentence, then its meta beside it
— "3 behind it · 42% · still forming", the date, the bin. The meta is
`white-space: nowrap` and refuses to shrink. The sentence is a `textarea` with
`field-sizing: content`, whose min-content width is about one character. On a
350px column the row over-constrains, the meta wins every pixel, and the
sentence takes what is left.

Confirmed against the commit *before* the touch-target work, so it is not a
side effect of it — it had been shipping. Every measured count passed the whole
time: nothing overflowed the viewport, no test failed, and every character of
the text was present on screen.

At ≤520px the row wraps instead: the sentence takes the full line and the meta
follows underneath as a row, which is what every other layer already does with
the same content.

---

## 17. Near-white on near-white, by two different roads

**Blocking.** [measured] — found 2026-08-24, **fixed the same day.**

Also not found by the original audit, whose summary reads "measured text
contrast passes on every surface tested". It does not, on the one that matters
most, and this is the correction.

`--ink` is a **post-it's** variable: `Surface.tsx` writes it per sheet from
that sheet's paper, and `.sf-postit-text` paints itself with it. `/signals`
reuses `.sf-postit-text` for its rows, and those rows are not post-its — so
`--ink` fell all the way through to the value `chrome.css` defines for the
world, `#e8edf4`.

That is the **world's light ink on the surface's near-white paper**:

| | ratio |
|---|---|
| signal sentence, as shipped | **1.15:1** |
| after | **17.63:1** |

Every claim the machine had made about the person — the entire content of
`/signals`, on desktop and on phone — was invisible. The meta beside it used
`--sf-ink-3` and read normally, which is why the page looked populated and
merely blank in the middle.

The surface root now declares a floor: `--ink: var(--sf-ink)`. A post-it still
wins, because `Surface.tsx` sets it inline on the sheet — verified after the
fix, three sheets still carrying three different warm inks. What changed is
only the case where nothing set it, and there the answer can never be the other
palette's ink.

### And the same failure by a second road, on the largest words on the screen

`.sf-roomname` — "Demo User's top of mind", the page's own title — measured
**1.15:1** as well, and the floor above did not touch it, because it does not
read `--ink` at all.

`chrome.css` carries two bare `h1, h2 { color: var(--w-ink) }` blocks. **An
element selector in another sheet beats a colour `.sf` sets and lets inherit**,
because the element selector applies *to* the element while inheritance only
reaches it. So the title computed `#e8edf4` while its own parent `.sf-head`
sat correctly at `#171613` one level up.

This contradicts the promise at the top of `surface.css` — *"Every rule here is
scoped under `.sf`, so nothing in the seventeen thousand lines of global.css
can reach it"*. True of class rules; false of element ones, and the gap shipped
a blank page twice. That header now says so, and the surface states its own
heading ink rather than relying on inheritance another sheet can outrank.

Every surface now measures ≥4.5:1 on every heading, sentence and label. The
gate checks titles as well as body text — checking only the body would have
missed this one.

Both 16 and 17 are gated by `journeys:the-hand`, which walks the six routes at
390px and now checks legibility alongside geometry. Replayed against the old
fall-through it reports `1.15:1` against a 4.5:1 threshold.

**What these two say about the audit that missed them.** Both are invisible to
every check the product had: no exception, no failed count, no overflow, no
console error. The audit's own contrast pass sampled labelled text and never
looked at the field that carries the sentence. A screen can be fully rendered,
fully populated, and completely unusable, and nothing but a person or a
measurement aimed at the right element will say so.

---

## 18. The four things you can do about the machine's conclusion were unreachable

**Major.** [measured] — found 2026-08-24 while proving workflow E2, **fixed the
same day.**

The same bug as finding 14, in a second place, found a day later.

Beside the top-of-mind headline sit the four things a person can do about the
one sentence the machine has concluded about them: **read it again**, **keep
this one up**, **say it in my words**, **not this**. All four were
`opacity: 0; pointer-events: none`, revealed by:

```css
.jar-hq:hover .jar-board-acts { opacity: 1; pointer-events: auto; }
```

`.jar-hq` carries `pointer-events: none` so the world underneath stays
draggable, and **an element that takes no pointer can never match `:hover`.**
Measured: no pointer position on the page revealed them. They worked only under
the `@media (hover: none)` fallback — so, as with finding 14, they worked on a
phone and had never once been reachable on a desktop.

**This is my miss, not a new class of bug.** Finding 14 diagnosed exactly this
and fixed `.jar-edge`; it never swept the file for the other rule that shared
the selector. `grep 'jar-hq:hover'` returns two, and only one was fixed.

The fix had a second half that would have shipped just as quietly:
`pointer-events` **inherits**. Removing the parent's `none` was not enough —
with nothing declared, the children inherit it and stay unclickable while
looking entirely correct. It is stated explicitly now.

### The gate, and why it asserts hit-testing rather than style

`journeys:entry-actions` calls `document.elementFromPoint` at each control's
own centre and requires it to come back as that control. That catches
`opacity: 0`, an inherited `pointer-events: none`, and anything lying on top —
including whatever the next version of this mistake turns out to be, which will
not be named `.jar-edge` either.

The `--negative` run proves the choice was necessary. Under the original rule:

```
"READ IT AGAIN" cannot be hit at its own centre (opacity 1)
"KEEP THIS ONE UP" cannot be hit at its own centre (opacity 1)
"SAY IT IN MY WORDS" cannot be hit at its own centre (opacity 1)
```

**Opacity 1** — because the sabotage sits on the parent while the check reads
the child. An opacity assertion would have passed with all four controls
invisible and dead.

---

## The MCP journey, gate by gate

`pnpm test:live` from `waka-eng/waka-mcp`, pointed at this stack:
**6 passed, 3 failed.**

| Gate | Result |
|---|---|
| 1–4. signup, consent login, credential binding, capture | pass |
| 5. recalls layer 1 in both profiles | pass |
| 6. recalls layer 2 in both profiles | fail — no signals ever arrived |
| 7. reads both top of minds | fail — no artifact ever arrived |
| 8. server denies editing the human profile's signal | pass |
| 9. principles: canonical document reads across the matrix | fail — declaration became an inspiration |

**6 and 7 are the missing `GEMINI_API_KEY` and nothing else.** Layers 2 and 3
are produced by background model calls; with no key they are never produced,
and the gates time out waiting. They say nothing about the client.

**9 is finding 3**, and it is the one worth keeping. It is also the reason
that finding is worth its severity: the failure mode was invisible from the
product surface and only became visible because a test asserted on the
`created` discriminator. A person declaring a principle has no such assertion.

The permission matrix itself held everywhere it was exercised — including the
cross-profile write denial, which is the one that matters most.

---

## What was not covered

Named so the gaps are not mistaken for clean results. Three of the five gaps
this section opened with have since been closed, and are kept here with what
closed them rather than deleted — a gap that quietly disappears reads as one
that was never real.

**Still open:**

- **Google OAuth.** Not configured; the button was never pressed. No harness
  can close this one without a real Google project, so it stays open by
  nature rather than by neglect.
- **The sky's arrival, on a real sky.** `ways-out` checks that the sky leans
  — `lean` is the camera's own scalar and exists on an empty account, so
  ripping the peek out fails the journey. What it cannot check on a fresh
  account is that an elected statement *arrives* near the seam, which is the
  exact bug that shipped: the peek elected correctly, eased correctly, and
  parked every cloud in the part of its own sprite that has no light left in
  it. The journey says `sky leaning (1) but EMPTY` when it walks that half
  without measuring it. **This is structural, not an oversight.** A sky needs
  signals, signals only ever come from derivation, and there is no route that
  writes one — so a key-free suite cannot produce one, and `journeys` has to
  stay key-free to run on every pull request. Closing it means a browser pass
  gated on the key, the way `e2e:erasure` is gated.
- **Password recovery.** Deferred by decision, no mail provider. The one item
  in this document that can lock a real person out of their own memory.
- **Findings 9 and 13.** Out of scope by founder decision: the world as one
  unlabelled canvas to assistive technology, and the consent page's missing
  decline control.

**Closed since:**

- **Rooms with more than one member.** Now driven, not read. `e2e:rooms` runs
  nine checks across four accounts and proves the thing this entry called the
  highest-stakes surface in the product: removal re-keys the door and leaving
  does not, the old key is dead, only the owner can remove or close, and a
  removal reaches no further than the room it named.
- **`tools/e2e/*.ts`.** All of them run, and there are eleven suites now
  rather than four, plus two support servers they lean on. `docs/goals/every-workflow-works.md` carries the inventory, and
  every row in it reads either *proven by ‹suite›* or *unproven, because
  ‹reason›*.
- **Attachments and images.** A local S3 stub (`pnpm e2e:s3-stub`) closed the
  upload path: presign → PUT → HEAD is driven end to end, and `e2e:erasure`
  uses it to prove a deleted account's bytes are actually gone (`HEAD` 404)
  rather than merely dereferenced.
- **Everything downstream of a model call** is now *partly* covered rather
  than not at all: `e2e:signals`, `e2e:top-of-mind`, `e2e:principles` and
  `e2e:erasure` all spend real calls when a key is present, and CI skips them
  with a loud "NOT RUN" step when it is absent. `e2e:principles` is recorded
  as a diagnostic rather than a gate, because the distiller legitimately
  returns no candidate from the same fixture about half the time.
