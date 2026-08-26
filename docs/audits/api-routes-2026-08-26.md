# The API route sweep — is anything mounted that nothing calls

**Date:** 2026-08-26
**Status:** one-off measurement. Deliberately **not** shipped as a gate — see
the last section.

## Why it was worth asking

`orphans.test.ts` guards the web package: unreachable modules, uncalled
exports. The API has no equivalent, and it is the half that is hardest to
reason about, because it serves three audiences at once — the web app, the
CLI, and agents holding their own keys. "The client does not call it" is not
evidence of death here, which is exactly why nobody had swept it.

## The result

**96 routes resolved. Every one is addressed by some caller.**

The single route with no caller anywhere in this repository is:

```
GET /api/auth/callback/google
```

which Google calls. Live by definition.

The one env-gated route — `POST /api/principles/refresh-test-trigger`,
registered only when `WAKA_ENABLE_PRINCIPLES_TEST_TRIGGER=1` and absent in
deployed stages — is called by `tools/e2e/principles.ts`. Fenced, documented,
and used.

No dead routes.

## Three false findings first, all the same mistake

The sweep reported **56 dead routes**, then **33**, then **3**, then none. Each
round was a bug in the matcher, and the last one is worth writing down because
it is subtle.

1. **56.** The mount map was keyed by the variable name at the *mount* site
   (`groupsRoutes`), which is not the router variable inside the file. Almost
   nothing resolved, so almost everything looked unmounted. Caught because the
   output flagged `POST /groups` and `GET /weather` — routes the world visibly
   uses every session.

2. **33.** `\w+\.get\("…"\)` matches `c.get("session")` — Hono's *context*
   getter — so half the list was invented paths like
   `/api/inspirationssession`. Routes always start with `/`; context keys do
   not.

3. **3, and then 0.** `principles.ts` is mounted at **two** prefixes,
   `/api/principles` and `/api/principles.md`. Crossing every route in the file
   with every prefix of the file invents paths that were never served:
   `/api/principles.md/reorder` has no caller because it does not exist. The
   real `/api/principles/reorder` is called by `reorderPrinciples`, and the
   test trigger is called by an e2e walk.

All three failed in the same direction — **reporting live code as dead** — and
all three were caught the same way: the output named something obviously in
use, so the instrument was wrong rather than the product.

## Why this is not a gate

Every other check built this session was made permanent. This one is not, and
the reason is the section above.

A gate is a promise that a failure means something. This matcher needed three
corrections to stop accusing working code, and the remaining hard part —
resolving *which* of a file's mount prefixes a given route belongs to — needs
following the router object each handler hangs off, not the file it lives in.
Until it can do that, a red run would more likely mean "the matcher met a
second mount" than "somebody left a dead route", and a gate that cries wolf is
worse than no gate: it trains the next person to skip it.

The measurement stands. Enshrining it does not, yet. If the API grows a second
dual-mounted file the sweep is cheap to re-run by hand from this document.
