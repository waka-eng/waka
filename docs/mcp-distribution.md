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

For personal memory, open **Settings → My profile · MCP**. The **MCP setup**
tab guides three steps: create or choose a personal key, connect the AI client
with a setup prompt (manual instructions are secondary), and test with
`waka_verify_connection`. Enter the key locally, never in chat. The prompt pins the human profile and uses key authentication; it
does not use the broader personal browser-login session. After verification,
the save prompt adds inspirations directly to My profile. Manage or revoke
that key in the adjacent **API keys** tab. A key is a standing credential for
apps and scripts as well as MCP; agent MCP can alternatively use browser sign-in.
Creating an agent profile is unnecessary. The test reply proves the MCP binding;
the manual activity refresh only reports the selected key’s last use. It does
not label general API activity as MCP verification and does not poll.

For agent memory, open **Settings → Agent profiles → the agent** and choose
MCP connections or API keys. Copy the setup prompt first, or expand the manual steps. The instructions
pin the profile ID, give each browser login its own `WAKA_HOME`, and use a
profile-specific MCP server name. Public downloads require no repository access.

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
