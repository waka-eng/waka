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
| 1 | **Blocking** | The world is a blank black screen whenever either font CDN is unreachable |
| 2 | **Blocking** | `pnpm demo:seed` — the documented way in — fails against current migrations |
| 3 | **Major** | A declared principle is silently filed as a note when the model call fails |
| 4 | **Major** | The product is two themes: near-black world, near-white surfaces |
| 5 | **Major** | Sign-in's primary action is the weakest thing on the screen; no password recovery exists |
| 6 | **Moderate** | The "other screens" menu opens on top of the sentence it obscures |
| 7 | **Moderate** | Keeping something — the core act — confirms almost invisibly |
| 8 | **Moderate** | 21–22 touch targets per surface under 44px, destructive ones at 20px |
| 9 | **Moderate** | The world is one unlabelled canvas to assistive technology |
| 10 | **Minor** | Three product nouns on the sign-in screen |
| 11 | **Minor** | `/signals` prints a raw confidence percentage with nothing to read it against |
| 12 | **Minor** | The demo fixture describes a signal state the product forbids creating |
| 13 | **Minor** | The consent page has no decline control |

Working well, and worth not breaking: Korean coverage is genuinely complete;
capture round-trips correctly; no surface overflows horizontally on a phone;
measured text contrast passes on every surface tested; the permission matrix
holds under the MCP live gate.

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

Named so the gaps are not mistaken for clean results:

- **Everything downstream of a model call.** Derivation, synthesis, minting,
  enrichment, image description. No `GEMINI_API_KEY`.
- **Google OAuth.** Not configured; the button was never pressed.
- **Rooms with more than one member.** The seed creates none, so the sharing
  boundary — what crosses and what must not — was read, not driven. Given it
  is the highest-stakes surface in the product for privacy, it deserves a run
  of its own against a two-account stack.
- **`tools/e2e/*.ts`.** The four documented suites spend model calls and were
  not run. Their coverage as *workflow* proof is a separate question from this
  one and was explicitly out of scope here.
- **Attachments and images.** No S3 bucket configured.
