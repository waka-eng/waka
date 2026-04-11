import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadWorkspaceEnv } from "./workspace-env.mjs";
import { getGoogleProviderConfig } from "../apps/web/src/auth/providers/google.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = join(scriptDir, "..");
const appRoot = join(workspaceRoot, "apps", "web");
const env = loadWorkspaceEnv({
  workspaceRoot,
  appRoot,
  env: process.env,
});
const config = getGoogleProviderConfig(env);

console.log("Google OAuth env configuration is valid.");
console.log(`GOOGLE_CLIENT_ID=${config.clientId}`);
console.log(`GOOGLE_CLIENT_SECRET=${"*".repeat(config.clientSecret.length)}`);
