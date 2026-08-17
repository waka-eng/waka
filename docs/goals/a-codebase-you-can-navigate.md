# Goal: the whole codebase, not just the frame loop

Status: **draft v1 (2026-08-17).** Branch `goal/frontend-you-can-read`.
Nothing merged, no PR open.

Follows `close-the-two-gaps.md`, which is finishing `Home.tsx`'s state. That
work is real but it is one file. The owner's question was about the CODEBASE:
*is it restructured so it is extremely easy to navigate and understand?* The
honest answer has been "about forty per cent", and forty per cent is a number
about `Home.tsx`, not about 50,092 lines across three packages.

This document says what 100% means in numbers, so it can be checked rather
than felt.

## Where it actually stands (measured 2026-08-17)

| package | files | lines |
|---|---|---|
| api | 108 | 26,689 |
| web | 46 | 22,736 |
| admin | 6 | 667 |

The twenty largest files hold roughly half of everything:

| lines | file |
|---|---|
| 10,959 | `packages/web/src/pages/Home.tsx` |
| 1,863 | `packages/api/src/routes/groups.ts` |
| 1,745 | `packages/web/src/lib/api.ts` |
| 1,266 | `packages/api/src/routes/inspirations.ts` |
| 963 | `packages/api/src/lib/top-of-mind-synthesis.ts` |
| 880 | `packages/api/src/lib/signal-derivation.ts` |
| 854 | `packages/web/src/lib/fixture.ts` |
| 817 | `packages/web/src/pages/Login.tsx` |
| 799 | `packages/api/src/routes/auth.ts` |
| 791 | `packages/api/src/lib/signal-enrichment.ts` |
| 783 | `packages/api/src/queue/gemini.ts` |
| 745 | `packages/api/src/routes/signals.ts` |
| 732 | `packages/api/src/lib/queue.ts` |
| 706 | `packages/web/src/pages/Profile.tsx` |
| 693 | `packages/api/src/routes/auth-google.ts` |
| 672 | `packages/api/src/routes/attachments.ts` |

`Home.tsx` alone is 48% of the web package.

## What 100% means

Seven gates. Each is checkable by a command, not by opinion.

**G1 — No file is a landmark.** Nothing over 800 lines, OR the file carries a
header saying in plain words why it is one thing that must not be split. A
file over 800 lines with no such header fails. `Home.tsx` under 2,000.

**G2 — A reader knows where to start.** A `docs/map.md` that answers, for
someone who has never seen this repo: what are the three packages, what is the
one path a request takes end to end, and which six files should be read first.
Every directory under `src/` named in it.

**G3 — One name for one thing, enforced.** The vocabulary gate already does
this for the frontend's canon words. Extend it to `packages/api`, so the two
sides cannot drift apart again.

**G4 — Sibling directories are not near-synonyms.** `space/` and
`space-kinds/` sit next to each other and nothing in either name says which
holds what. Resolve it — merge, rename, or document the distinction in a way
that survives a reader who has not read this file.

**G5 — Every module says what it needs.** `measure-groups.mjs` is the check:
no function in a frame loop or request handler should reach past four state
groups without a written reason.

**G6 — The tests describe the product, not the fixture.** Already burned once:
a test suite passed while describing the offline fixture because it mocked
`lib/api` instead of `lib/data`. Every suite states in a header what layer it
mocks and why.

**G7 — Nothing green is blind.** Every gate this repo trusts is proven to fail
at more than one point. The vocabulary gate was clean over half a file for a
week because it was only ever proven at one location.

## Order

Largest lever first, but never a file whose tests do not exist yet.

1. **Finish `Home.tsx`** — 4c, 4d, then `draw` (531 lines, 7 groups) and
   `tick` (467, 11). This is already in motion and is the single biggest lever.
2. **`packages/web/src/lib/api.ts`** (1,745) — the client. Split by resource,
   matching the API's own route files, so the two sides read as mirrors.
3. **`packages/api/src/routes/groups.ts`** (1,863) and `inspirations.ts`
   (1,266) — the two biggest route files, and both hold security-relevant
   logic that a reader currently has to find in a haystack.
4. **The three Gemini-adjacent libs** — `signal-enrichment`, `signal-
   derivation`, `top-of-mind-synthesis`, `gemini`. Do these AFTER the two open
   security findings in them are fixed, not before: fixing a bug in code that
   is being moved is how a fix gets lost.
5. **`Login.tsx`, `Profile.tsx`, `fixture.ts`** — the remaining web files.
6. **G2, G3, G4, G6, G7** — the documentation and gate work, last, because it
   describes where things ended up.

## Rules

- Every commit green: `pnpm test` (vocabulary gate + web suite) and
  `tsc --noEmit`; the API suite for API changes.
- **Do not start an extraction that cannot finish green in one sitting.**
  Half-moved code is worse than unmoved code — two vocabularies for one
  concept and no compiler error saying so.
- Measure before claiming separability. Three times now a claim about this
  codebase has been reversed by measuring it.
- Never merge into `dev`. Never open a PR. Never seed or hard-code data.

## Log

_(appended per step at execution)_
