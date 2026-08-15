/**
 * Renders the CLI consent page to a file so it can be opened and looked at.
 *
 * The page is API-rendered HTML with no SPA behind it, so nothing in the web
 * app's build or test run ever exercises how it looks. It is also the one
 * screen standing between a stray navigation and a live credential, which
 * makes "is it actually legible, and does it say what it does?" a question
 * worth answering with eyes rather than assertions.
 *
 *   pnpm tsx packages/api/scripts/render-consent-page.ts [out.html]
 */

process.env.JWT_SECRET ??= "render-only-secret";

const { renderConsentPageForPreview } = await import("../src/routes/auth-cli.js");
const { writeFileSync } = await import("node:fs");

const out = process.argv[2] ?? "/tmp/waka-consent-preview.html";

writeFileSync(
  out,
  renderConsentPageForPreview({
    accountEmail: "mina@example.com",
    callback: "http://127.0.0.1:53124/callback",
    state: "preview-state",
    deviceLabel: "claude-code",
    candidates: [
      { id: "profile-human", name: "Mina", type: "human" },
      { id: "profile-agent", name: "Scout", type: "agent" },
    ],
    preselectedId: "profile-human",
    consentToken: "preview.token",
  }),
  "utf8",
);

console.log(out);
