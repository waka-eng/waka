# Native authentication rollout and Apple sign in plan

Status: M2 accepted in owner-approved simulator scope. PRs 359/360 and additive
migration 0068 are deployed to dev. Production is unchanged; registered signing
and verified device associations remain deferred. Exact evidence and limitations
are in the [completion audit](../goals/native-accounts.md).

## Google and native sessions

Keep the existing HTTPS Google callback and account resolution. The native app
opens the OS browser, never its app WebView, with a signed server-side binding
to its app identity and S256 PKCE challenge. Google authenticates the person;
WAKA returns a two-minute handoff code. An atomic exchange binds the resulting
session to the human profile. The callback contains no reusable session token.
Google's
[installed-app guidance](https://developers.google.com/identity/protocols/oauth2/native-app)
disallows embedded WebView authorization and describes supported browser flows.

Store native credentials and pending sign-in/retirement metadata only in
Keychain/Keystore. Browser cookies remain the web transport. A failed secure
write cannot establish a native sign-in. Durable retirement prevents offline
logout from restoring the old session; server revocation retries when online.
Remote revocation cannot be guaranteed while offline.

## Schema deployment and rollback

Migration `0068_mobile_login_codes` adds one transient auth table, its profile
foreign key and two indexes. It does not rewrite accounts, memories or sessions.
Generate and verify the migration snapshot/journal before deployment. Rehearse
the entire migration corpus and parallel exchanges on disposable loopback
Postgres. Verify the actual remote host/stage before any application; never
infer database isolation from an env filename.

Deploy in this order: apply the additive migration to the verified stage,
deploy the supporting API, verify its web-auth regressions and code exchange,
then distribute native builds. Do not apply to production as part of dev rollout.
If the API must roll back, stop distributing the affected native build and revert
API code; keep the additive table so rollback does not lose in-flight state or
require destructive DDL. Codes expire without granting sessions. A later explicit
cleanup can remove the unused table after confirming no clients depend on it.
Sessions already minted use the existing revocable session table and can be
revoked independently. No automatic historical account repair is needed.

## Sign in with Apple

Retaining Google in the iOS app means planning an equivalent privacy-preserving
login option under Apple's
[review rule 4.8](https://developer.apple.com/app-store/review/guidelines/#login-services).
Sign in with Apple is the proposed option; this milestone records its plan,
not a claim that a provider integration is already delivered.

Use the native AuthenticationServices flow with state and nonce, and verify
Apple identity tokens server-side against issuer, audience, expiry and signature.
Bind identity to Apple's stable subject and the configured team/app identity,
not the display name or email. Persist the first-returned name only with consent.
Private relay addresses are valid identities and must not be used to guess a
matching existing account. Register the relay mail sender when mail is introduced.

An existing signed-in user explicitly links Apple to their current account after
fresh authentication. An unsigned user with a possible existing account must
authenticate that account before linking; do not silently create a duplicate or
merge identities based on email alone. Handle already-linked Apple subjects,
account conflict, credential revocation, cancellation and Apple account erasure.
Keep the existing password/Google options available. Add the provider identity
schema and linking migration only when the actual Apple integration is approved.

## Verified public links

The native app should route only its configured WAKA HTTPS host and known
consumer destinations. Private destinations still pass through authentication
and server ownership checks. Cold/warm launches and login must preserve the
same intended path, query and fragment. Public share URLs use the canonical web
origin, never `capacitor://localhost` or `https://localhost`.

Verified associations require an Apple Team ID/registered app IDs and the actual
Android signing-certificate fingerprints. The
[Capacitor deep-link guide](https://capacitorjs.com/docs/guides/deep-links)
describes these prerequisites. Dev currently serves SPA HTML at both association
URLs rather than JSON. Deploy real association documents without SPA fallback,
with correct content types, only after validating the signing identities.
Do not substitute a temporary simulator/test key for the shipping certificate.
