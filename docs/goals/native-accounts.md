# Native accounts networking and deep links

Status: in progress (2026-10-07).
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
