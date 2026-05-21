import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

export interface SignedInWowDetailConfig {
  webUrl: string;
  apiOrigin: string;
  databaseUrl: string;
  email: string;
  password: string;
  credentialsGenerated: boolean;
  artifactDir: string;
  headful: boolean;
  timeoutMs: number;
}

interface ResolverDeps {
  now?: () => number;
  randomHex?: (bytes: number) => string;
  cwd?: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function normalizeUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)]$/, "$1");
}

function isLoopbackHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".local");
}

function assertLoopbackDatabase(databaseUrl: string): void {
  const parsed = new URL(databaseUrl);
  const host = normalizeHost(parsed.hostname);
  if (!isLoopbackHost(host)) {
    throw new Error(`Refusing to use non-local database host "${host}" for signed-in WOW detail QA.`);
  }
}

function generatedEmail(now: () => number, randomHex: (bytes: number) => string): string {
  return `waka-wow-detail-${now()}-${randomHex(3).slice(0, 6)}@example.test`;
}

export function resolveSignedInWowDetailConfig(
  env: NodeJS.ProcessEnv = process.env,
  deps: ResolverDeps = {},
): SignedInWowDetailConfig {
  const cwd = deps.cwd ?? process.cwd();
  const repoRoot = cwd.endsWith("/packages/web") ? resolve(cwd, "../..") : cwd;
  const databaseUrl = env.DB_CONNECTION_URL ?? env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DB_CONNECTION_URL or DATABASE_URL is required for signed-in WOW detail QA.");
  }
  assertLoopbackDatabase(databaseUrl);

  const providedEmail = env.WAKA_WOW_DETAIL_EMAIL?.trim();
  const providedPassword = env.WAKA_WOW_DETAIL_PASSWORD;
  if (Boolean(providedEmail) !== Boolean(providedPassword)) {
    throw new Error("WAKA_WOW_DETAIL_EMAIL and WAKA_WOW_DETAIL_PASSWORD must be provided together.");
  }

  const randomHex = deps.randomHex ?? ((bytes: number) => randomBytes(bytes).toString("hex"));
  const now = deps.now ?? Date.now;
  const credentialsGenerated = !providedEmail;
  const webUrl = normalizeUrl(env.WAKA_WOW_DETAIL_WEB_URL ?? env.WAKA_WEB_URL ?? "http://localhost:3010");
  const apiOrigin = normalizeUrl(env.WAKA_WOW_DETAIL_API_URL ?? env.WAKA_API_URL ?? webUrl);

  return {
    webUrl,
    apiOrigin,
    databaseUrl,
    email: providedEmail ? providedEmail.toLowerCase() : generatedEmail(now, randomHex),
    password: providedPassword ?? randomHex(16),
    credentialsGenerated,
    artifactDir: resolve(env.WAKA_WOW_DETAIL_ARTIFACT_DIR ?? resolve(repoRoot, ".hermes/qa-artifacts/wow-detail-signed-in")),
    headful: env.WAKA_WOW_DETAIL_HEADFUL === "1",
    timeoutMs: Number.parseInt(env.WAKA_WOW_DETAIL_TIMEOUT_MS ?? "60000", 10),
  };
}

export function textMatcher(labels: string[]): RegExp {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("|"), "i");
}

export function buildSafeEvidence(
  config: Pick<SignedInWowDetailConfig, "webUrl" | "apiOrigin" | "email" | "credentialsGenerated">,
  details: Record<string, unknown>,
): Record<string, unknown> {
  return {
    webUrl: config.webUrl,
    apiOrigin: config.apiOrigin,
    email: config.email,
    credentialsGenerated: config.credentialsGenerated,
    ...details,
  };
}
