# Public MCP installation

Public users install a ready-to-run client from WAKA's `/downloads/` URL
using Node.js 20+ and `npx`. They do not need GitHub access, Git, pnpm,
a checkout, a build, or an npm account. The prompt and manual setup both
use this same immutable package URL. The artifact is served with the web
app, including when the API is hosted on a separate origin.

The archive bundles only the MCP client, login CLI, and dependency notices.
It has no runtime dependencies, install scripts, source maps, credentials,
or backend code. Both browser sign-in and API keys retain profile binding;
browser sign-ins keep separate credential directories per profile.

## Maintainer release

1. Commit and test the intended `waka-mcp` client checkout. Packaging also
   requires a clean checkout and a passing production dependency audit.
2. Run `pnpm mcp:package [path-to-waka-mcp]`. The default source is the sibling
   `../waka-mcp` checkout. Only maintainers need it.
3. Run `pnpm mcp:check`. This installs from an anonymous HTTP download into
   a fresh npm cache and checks the packaged CLI and MCP protocol.
4. Commit the generated archive in `packages/web/public/downloads/`, the
   updated `packages/web/src/lib/mcp-distribution.json`, and any packaging
   changes. Deploy the web app normally.

Keep every previously published archive. Existing client configurations
contain immutable URLs, so removing an old archive would break fresh installs
of those configurations. The manifest points new setups at the latest release.
Web builds check the archive hash and allowlist without requiring the private
client checkout. Public URLs become available when the web deployment finishes.

## Connection and access rules

For personal memory, open **Settings → My profile · MCP → MCP setup**.
For agent memory, open **Settings → Agent profiles → the agent → Set up MCP**.
Both show the destination and one setup prompt to paste into Claude Code or
Codex. The prompt installs the public client for the current project, preserves
unrelated settings, and calls `waka_verify_connection` without changing memory.
The AI must confirm the returned profile name and ID before reporting success.
There is no installation wizard or key management in the MCP setup view.

Personal setup uses a personal key, never the broader personal browser-login
session. If needed, the prompt directs the user to **My profile · MCP → API keys**
to create one and enter it locally, never in chat. All key instructions,
configuration examples, activity, creation and revocation live in **API keys**
under the relevant profile. Agent setup uses browser approval by default;
key-based agent setup remains available from the API keys tab.

Instructions pin the profile ID and use a profile-specific MCP server name.
Browser login has a separate `WAKA_HOME` per profile. Existing agent connections
can be retested or disconnected from the connection list. Key activity alone
is never presented as verified MCP access. Nothing polls for a connection.

- Browser approval creates a separate 30-day session for the chosen profile.
  The consent page locks an explicitly requested profile and describes its
  permissions. Revoking the connection removes that session; it does not erase
  memory, end the browser session, revoke an API key, or remove local MCP config.
- Agent API keys read and write only their agent. Personal keeper keys can read,
  capture and propose captures for approval; they cannot edit/delete memory,
  reach agents or make account decisions. Both can identify their own profile
  and verify that binding. Keys have no automatic expiry and stay active until
  revoked; there are at most five live keys per profile.
- A legacy personal-profile browser-approved CLI session has full account
  permissions, as the consent page states. It is broader than a keeper key.
- Verification calls `waka_verify_connection` without saving memory. It proves
  a matching live credential at that time. A configured server or an old
  verification timestamp alone is not proof that the current connection works.
- Scope chooses where the AI client enables WAKA. It does not change what the
  credential can access. The one-launch Codex command applies to a new CLI
  launch; existing configured MCP servers remain enabled.

Published archive URLs are immutable. Re-running setup with the current package
URL updates a client to the current parser; existing configurations retain their
older URL. This review adds support for reading audio and decision captures
without rejecting the entire inspiration list. It does not give the MCP capture
tool an audio upload capability.


## MCP 0.2 refresh (dev delivery only until separately promoted)

Client and app changes are coordinated PRs targeting dev. The final app archive
must be built from a clean client commit already published on origin/dev; no
local-only source commit belongs in the distribution manifest. The packaging
command refuses an unpublished final source. `--candidate-dir /tmp/<directory>`
builds a test-only archive/manifest without modifying the distributed app files.
Package it twice from identical source/lock/build inputs to verify reproducible
bytes, run the real archive/API fixture, and retain prior archives unchanged.

Upgrade/reinstall from the new immutable package URL. Existing installed archives
do not automatically update, and old keyless capture remains non-idempotent.
New capture/detail/read-only contracts require the refreshed API; there is no
fallback to a broader token, old unsafe POST or another profile. New consent is
human-only; retained legacy keys remain isolated. Never create an agent profile.

Settings defaults NEW personal keys to read_only, while an omitted API `access`
retains read_capture compatibility. Server-issued read_only denies memory writes
through direct HTTP as well as MCP; WAKA_MCP_MODE=read_only additionally hides and
denies capture and requires the matching backend capability. It does not revoke
old keys or turn a broad credential into a narrow one. Authentication bookkeeping
and consultation receipts are writes distinct from memory mutation.

Recall admits only current supported signals with own compatible model/dimensions
and current statement input hash. A fresh post-provider snapshot repeats source
proofs and uses canonical independent review/inspiration witnesses, owner feedback
and conflict qualifiers. Locked unsupported wording remains readable as qualified
detail, not semantic proof. There is no backfill/re-embedding or repair on GET.
Zero eligible compatible vectors means zero provider calls. Account-wide fixed
windows permit 10 attempts/minute and 60/hour; reservations commit before one HTTP
attempt. Failure consumes its attempt. 429 includes Retry-After; provider failure
is 503 with a fixed unavailable code, no fabricated scores or raw provider error.
These are attempt controls, not a universal dollar cap. The provider deadline is
5s; client HTTP including body consumption is bounded to 15s and 4 MiB per request.
The three-request cold capture-status path can therefore take up to 45s before
client errors; there is no automatic polling or POST retry.

Each new capture must retain its caller-generated UUID requestId and exact
material. Idempotency-Key uses the existing atomic save ledger; a committed capture
and pending processing are separate states. Lost acknowledgement, malformed success,
body failure or uncertain 5xx means UNCERTAIN: reconcile the SAME ID. A missing
committed row does not prove an in-flight save failed. Changed-material replay
conflicts; no new ID is silently invented and no processing retry tool is exposed.

Read tools provide on-demand owned inspiration text/reflections (shared max32,768
characters with truncation flags), safe media identity only, and at most20 current
inspiration/review examples per signal detail. No object keys, signed URLs, raw
remote errors or arbitrary URL fetch is exposed. Source detail uses a repeatable
snapshot; derived-signal detail records a consultation. List results remain
previews. Owner-locked does not mean the owner authored every word.
Principles returns the exact canonical markdown (including its empty state) with
one memory HTTP read and one consultation, never generation/refresh on GET.

Migration0087 adds keeper_keys.access with read_capture default/check and one
count-only account_recall_limits row/account (account deletion cascades). No human
memory/vector rewriting. The PG17 rehearsal must attest old key/hash/words,
invalid-access refusal, monotonic nonfuture journal and idempotent ledger replay.
Rollback keeps these additive fields/table. New read_only keys use the disjoint
waka_readonly_ prefix: old authentication rejects them, rather than widening to
capture. New auth requires the prefix and stored access to agree. Legacy keys
retain waka_keeper_/read_capture; no real key is converted, rotated or revoked.

No media/decision/proposal capture, chat/admin/edit/delete, model switch, extra
metric series, cloud resources, secret changes or production rollout is included.


### Rehearsed release evidence and limits

The local PG17.11 baseline reproduced empty-set embedding, material-edited-during-
HTTP serving and unsupported locked recall. Canonical recall regressions now
exercise strict space/hash/current support, review-only witnesses counted once,
current owner feedback and post-HTTP edit/delete/exclusion. Real account-counter
contention/rollback/window fixtures test attempt controls. No provider quality,
availability or dollar budget is inferred from deterministic fake vectors.

The packed stdio client runs against real HTTP/auth and disposable PG with
nonempty captures/signals/reading/Principles, not mocked tool registration.
Malformed response after actual commit is uncertain; same-ID lookup/replay keeps
one capture. Missing lookup is explicitly not proof of failure. Tests cover full
owned detail/current qualifiers, foreign IDs, human read-only direct HTTP bypass,
legacy binding/revocation and one Principles consultation. The retained old archive
also reads/captures compatibly and cannot bypass new backend read-only enforcement.
The old client repo's optional paid live suite (new agent creation/foreign-human
reads) was obsolete; it is replaced by a separately opt-in loopback-only read
fixture with no model or profile creation. Existing automatic offline login tests
and real packaged binding/API tests remain. These are synthetic local proofs,
not live user-content, provider, latency or production acceptance.

The client production audit required only Hono4.13.16 and node-server2.1.6 override
patches, matching the app. Primary advisories include
[Hono middleware routing](https://github.com/advisories/GHSA-h7mg-cq63-vhpq),
[node path parsing](https://github.com/advisories/GHSA-jpvv-r467-5p4w), and
[node WebSocket upgrade errors](https://github.com/advisories/GHSA-qv5m-9pm6-hqp3).
These HTTP middleware paths are not a demonstrated stdio exploit. The refreshed
production dependency graph audits clean; older immutable archives are retained,
not silently replaced. No extra runtime dependency or paid service is added.
