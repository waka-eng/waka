# Native accounts networking and deep links

Status: in progress (2026-10-07) — local account journeys verified;
live provider/domain acceptance and remaining native cases are open.
Branch: `codex/capacitor-m2`, based on M1 `04f7e5a`.

## Objective

Implement M2.1–M2.6 from the accepted
[mobile plan](../plans/2026-10-06-capacitor-mobile-plan.md). Reuse the existing
consumer UI and account/human-profile boundaries on Android and iOS. Stop
after M2; capture hardware integration and store distribution remain later work.

## Gates

1. Native password login/signup and session restoration use Keychain/Keystore.
   Credentials reach only the configured WAKA API; signed attachment requests
   remain unchanged. Browser cookies, cancellation and bounded request failure
   behavior remain correct. Revocation/expiry/logout and identity changes clear
   stale UI and reject late responses.
2. Google sign-in uses an OS browser and a server-backed, expiring, single-use
   handoff bound to the initiating app, state and S256 PKCE. No session token
   travels in a URL. Mobile sessions bind only to the human profile. Cancelled,
   replayed, expired and wrong-destination attempts fail safely.
3. Record the Sign in with Apple implementation plan, applicable review rules,
   explicit existing-account linking and private-relay behavior. M2 asks for
   a plan, not a silently substituted production Apple integration.
4. Configure canonical public URLs and Universal/App Links with validated
   owned hosts/routes. Preserve destination across login and cold/warm launch.
   Wrong-account private links do not reveal data. Real association/signing
   prerequisites must be verified rather than represented by fake identifiers.
5. Both platforms complete an authenticated synthetic slice: login, save text,
   reopen/read memory, open chat, terminate/relaunch and restore session.
   Also verify cancellation, expiry/revocation, logout and wrong-account links.
6. Any auth schema changes have migrations, targeted SQL checks and explicit
   rollout/rollback instructions before remote application.

## Verification boundaries

Use disposable loopback Postgres with explicit `DB_CONNECTION_URL`, never an
env-file database default. Keep native dev/prod public hosts unchanged outside
an explicit development-only test build. No shared-data writes, provider
account registration, deployment or store setup is implied. Provider callbacks
and domain association may require owner credentials/configuration; make
independent progress before asking for that information.

## Log

### 2026 10 07 start

M1 is complete and committed locally. Baseline native apps reach public health
but the consumer API client still uses browser cookies and has no mobile CORS.
Password auth already returns a bearer token; server sessions are profile-bound
and revocable. Raw resource fetches are limited to auth, reading and signed
attachment PUT. Google currently returns to the web origin using browser cookies.
First phase is native session storage and narrowly scoped API transport.

### 2026 10 07 native transport implementation

Password signup/login now adopt a human-profile bearer session only after secure
storage succeeds. Native API fetch omits cookies, restricts credentials to the
configured HTTPS API, refuses redirects and caller-provided authorization, and
keeps cancellation/deadlines active through buffered resource bodies. Signed
attachment PUT still bypasses this client. Web cookie behavior is unchanged.

Serialized credential updates reject superseded sign-in, protect new accounts
from old 401 responses, and persist encrypted logout retirement before removing
the active key. Pending server revocations retry without reviving the viewer.
Native UI does not hydrate from a localStorage viewer; expiry invalidates its
current identity. Auth mutations also reject late UI responses after logout.

Initial checks: 970 API unit cases pass (three paid suites skipped); 829 web
cases pass, including six session-ordering and ten native-transport cases; nine
real Hono CORS cases pass. These are source/protocol checks, not completion of
the native authenticated-slice gate. CORS allows only the two native WebView
origins and never grants cross-origin cookie credentials. Full simulator and
Google integration acceptance remains open.

Dev domain association endpoints currently return the SPA HTML with status 200,
not the required JSON association documents. Apple Team ID/registration details
were requested while independent implementation continues. No remote data or
configuration was changed.

### 2026 10 07 Google handoff and schema checks

Native Google now opens the OS browser and preserves its intended destination
in protected app storage. The shared Google callback resolves the same account
and human profile as web sign-in, but a mobile context issues only an expiring
code. Server-signed context, app state, S256 challenge and exact app identity
bind the exchange. Session minting and code consumption share a transaction.
Browser dismissal/app cancellation invalidate the pending attempt; password
sign-in removes it. Native expiry clears identity without trusting localStorage.

Migration `0068_mobile_login_codes` is additive and has a generated snapshot
and journal entry. Migration integrity passes five file checks. On explicit
loopback database `waka_mobile_m2_test_20261007`, five real SQL cases pass using
a two-connection pool: valid single-use exchange, wrong app/state/verifier,
expiry, concurrent exchange with exactly one session and refusal of agent
profiles. The per-suite schema was cleaned up; the empty owned test database
is retained for the simulator fixture. No remote schema or account was changed.

Three signed-context protocol cases pass; existing Google/CORS regressions
remain green. The latest full source checks passed 830 web and 973 API unit
cases (three paid suites skipped) before the final cancellation/URL changes.
Final checks and actual native authenticated journeys still remain.

The Apple linking/private-relay plan and additive deployment/rollback order
are recorded in [native auth decisions](../decisions/2026-10-07-native-auth-rollout.md).
Public profile, invite, reflection and key-setup URLs now choose canonical
WAKA origins in native builds. Verified domain association and complete
cold/warm route acceptance remain open.

### 2026 10 07 isolated iOS authenticated journey

The separate `im.waka.app.test` fixture build targets only the host's local API;
normal dev/prod retain their HTTPS hosts and cannot use fixture cleartext policy.
The fixture API owns a disposable loopback schema, has synthetic accounts and
model auto-drain disabled. Four build-policy cases and explicit fixture-origin
guards prevent replacing a shipping target. Production bundle inspection passes
with no local fixture API literals.

Real iOS UI typing exposed keyboard overlap with sign-in. Official MIT Keyboard
8.0.6 resize support, Android `adjustResize` and email-next/password-go actions
correct it without a web layout redesign. The iOS XCTest then completes ordinary
password login, text capture, reopen/read, opening chat without a paid send,
full app termination/session restoration, logout, switching accounts, refusal
to display the first account's captured words and logout persistence after
another restart. One full journey case passes; captured rows and zero remaining
sessions are observed in the disposable schema. Some earlier test-driver
failures were case-sensitive matches against uppercase/lowercase rendered labels;
semantic case-insensitive matches correct them, without bypassing app behavior.

Android authenticated acceptance, native browser handoff/cancellation, live
Google acceptance and verified associations remain open. The local simulated
Google provider is not counted as live provider verification. No remote push,
deployment, schema/data writes or paid calls occurred.

### 2026 10 07 Android and browser checks

Android emulator-5554 completes UI password login, text capture/save, warm-link
reopen, chat opening, force-stop/cold-link restoration, logout and second-account
private-source denial. The local audit records a 200 source read for the primary
account and 404 for the secondary; SDK screenshots show the words only for the
primary. Logout settles pending revocation after restart and `/auth/me` returns
401. Evidence: `work/mobile-foundation/m2-android-*`, `m2-native-audit.json`.

iOS's full journey passes with an explicit secondary-account 404 audit assertion.
Its simulated-provider OS-browser case also passes: dismissal cancels, a fresh
attempt exchanges its PKCE-bound code, and server revocation remains signed out
over two restarts. Receipt: `work/mobile-foundation/m2-ios-browser.json`. This is
not live Google verification. The guarded HTTP fixture now explicitly sets the
test environment so Safari can retain its cookie; deployed Secure defaults were
not relaxed. One stalled Xcode build was stopped; package resolution and a cached
retry recovered. Safari's overlapping AX address/Close geometry required tapping
the visible portion of the semantic Close control.

Unavailable links now offer account switching, preserve the intended destination
and do not suggest retrying a permanent access failure or disclose ownership.
Late native logout completion cannot erase a newer login. Superseded returned
credentials enter protected revocation retirement. Browser-close/code-delivery
ordering and pending-state cleanup have controller regressions.

Current checks pass: 857 web cases, 974 API unit cases (three paid suites skipped),
six mobile policy/association cases, 14 real SQL auth cases, API/web types and
five migration-integrity assertions. Normal iOS/Android dev/release builds pass,
including production fixture-origin exclusion. Native association configuration
and a signing-input-validated document generator are prepared; no guessed
identifiers or temporary keys are published.

Owner input remains pending: Apple Team ID/registered app IDs, dev PR/deployment
and additive migration approval for live Google QA, and Chrome Terms acceptance
on the Android test emulator. That browser test stopped at its legal prompt.
Native signup and remaining lifecycle/browser cases still need their final audit.
No remote push, deployment, schema/data writes or paid calls occurred. M2 stays
active; source tests and a simulated provider cannot replace its open gates.

## Current completion audit

| Requirement | Evidence and remaining work | Result |
| --- | --- | --- |
| M2.1 accounts and lifecycle | Password/signup/restart/expiry UI on both platforms; race/retirement tests; native revocation; SQL auth checks. Final profile-change walkthrough and live provider acceptance remain. | Partial |
| M2.2 scoped transport | Secure storage, real CORS/API journeys, wrong-host/header and cancellation/body deadlines; signed PUT unchanged. | Passed locally |
| M2.3 Google | Signed context, atomic PKCE/human SQL exchange, iOS simulated OS browser/cancel/revoke. Live Google and Android browser open. | Partial |
| M2.4 Apple plan | Explicit linking/private relay/token verification/review-rule plan. | Plan delivered |
| M2.5 verified links | Canonical URLs, route rules, entitlements/filters/generator, cold/warm routes. Registered identities and domain deployment open. | Incomplete |
| M2.6 authenticated slice | Capture/reopen/read/chat/restart/switch/logout UI on both platforms; no paid chat send. | Local slice passed |
| Schema rollout | Migration 0068/snapshot/journal, SQL rehearsal and rollout/rollback instructions. No remote application. | Prepared |

### 2026 10 07 signup and session expiry continuation

The previous goal turn made progress; its remaining prerequisites are unchanged.
The ordinary signup UI now has native acceptance on both platforms. Each creates
an account through the real 201 API response, reaches an empty personal Home,
and restores its protected session after process termination. Signup already
completes onboarding when a display name is supplied; an extra Continue step is
not part of this normal flow. The initial iOS test selected the tab rather than
the submit control, then incorrectly expected that extra step. Corrected native
selectors follow the actual flow without injecting a session.

The guarded fixture can expire its own session rows. Both apps then receive 401,
return to sign-in and remain signed out over another cold restart. Evidence:
`work/mobile-foundation/m2-ios-signup.json`, `m2-android-signup-home.png`,
`m2-android-expired.png`, `m2-android-expired-again.xml` and `m2-signup-audit.json`.
The expiry endpoint exists only in the disposable fixture entry, not the API.

Onboarding now uses the existing strict destination parser rather than a
prefix-only check that accepted external protocol-relative destinations. Web
regressions pass 857/857; API/web types, targeted auth/navigation cases and five
migration-integrity assertions pass. No paid calls, remote writes or deployment.

A read-only local signing inventory finds an Apple development identity with
Team ID `9F3U82NJ7X`, but no local provisioning profiles. This supplies a public
team identifier, not proof of registered WAKA app IDs or paid-domain capability.
Those registrations, domain publishing, live Google dev rollout approval and
Chrome Terms acceptance remain unverified/pending. Do not generate or publish
associations from certificate presence alone. M2 remains incomplete.
