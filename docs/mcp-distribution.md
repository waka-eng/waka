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
