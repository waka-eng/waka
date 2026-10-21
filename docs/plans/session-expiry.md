# Session expiry: return path and the web 401 (design, 2026-10-21)

Follow-up to `docs/known-issues.md` "Session expiry return path and signed-in hint". Four rounds
broke sign-in/out by changing the ordering of sign-out, cookie and keychain work. This design
changes none of it. Sign-out (`logout`), hydration, `login`/`signup`, the native session and its
token-compared 401 clear stay exactly as on dev. Two additions only.

## A. The return path belongs to the account that left (RequireAuth, sign-in-destination, Login)

Rule: when RequireAuth sees a session it had CONFIRMED (`!isLoading && account`) end, the bounce to
/login carries `{ from, owner: accountId }`. `resolveRedirect(location, signedInAs)` honours
`from` only when there is no `owner` or `owner === signedInAs`, and always through
`safeInAppPath`. Otherwise it falls to `?returnTo` (also `safeInAppPath`) or `/`.

- Form sign-in passes the account the server returned; a different account goes home.
- Sign-up is always a new account, so an owned `from` never applies.
- Google names its destination before anyone is known: it passes `signedInAs = null`, so with an
  owner present it carries `/`. The same account loses the return via Google; nobody else gains it.
- "Switch account" (Home) navigates with `{ from }` and no owner, on purpose: its point is another
  account opening that link. Unchanged.
- A bounce off a cached hint that `/auth/me` then rejected has no confirmed account, so no owner:
  dev's behaviour (the anonymous deep-link case) is unchanged.
- Native and web sign-out both end the viewer the way dev does; the owner is read from the guard,
  not from the sign-out path, so no sign-out code moves.

## B. A web 401 asks the server instead of deciding (transport, auth-context)

Rule: a web 401 from a non-`/api/auth/` read fires `waka:session-check`. The provider (web only)
runs ONE `/auth/me` at a time and clears the viewer only if all hold: it answered signed out, a
viewer is still present, and no sign-in/out/refresh happened since it started
(`authMutationRef`). It clears with `countAsAuthMutation: false`, never touches
`serverUnreachable`, cookies, drafts or the cached hint beyond `applyViewer(null)`.

## Each logged case

| Case | Why this cannot repeat it |
| --- | --- |
| Session ends mid-flow, no door | B: a confirmed signed-out answer clears the viewer, RequireAuth opens the door, A returns the same account. |
| Return path ownership / Google to the previous account's page | A: owner compared to the account that signed in; Google never carries an owned path. |
| Stale 401 erasing a new session | B: the 401 is never trusted; `/auth/me` with the current cookie decides, and a newer auth mutation discards the answer. Native keeps dev's token compare. |
| Late logout response erasing a new cookie | Logout is untouched; B issues no logout and sets no cookie. |
| Native sign-out not clearing the viewer | Native expiry/sign-out path untouched; B is web only. |
| loggingOutRef dropping later expiries | No suppression flag: B coalesces only while one check is in flight, then the next 401 checks again. |
| 401 landing mid-logout | Viewer already null, so B does nothing. |
| A 401 while signing in | Viewer null, and the clear does not count as an auth mutation, so `login` is never told "Sign-in changed". |
| keepCachedHint trapping on "can't reach WAKA" | Hydration untouched: an unanswered `/auth/me` still drops the hint; B's check failing offline changes nothing and raises nothing. |
| Failed keychain clear behind a signed-out UI | Native logout untouched (still awaits retirement before clearing). |
| Background refresh failure raising "unreachable" | B never sets `serverUnreachable`. |

## Not done here

- The door still says "Welcome back" after an expiry; it cannot tell expiry from sign-out without
  a reason flag on the sign-out path, which this design refuses to touch.
