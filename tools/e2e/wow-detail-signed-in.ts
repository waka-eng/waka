#!/usr/bin/env tsx
/**
 * Signed-in seeded WOW detail browser QA.
 *
 * Local/dev-only harness: ensures a local QA account exists, seeds curated demo
 * WOW rows when needed, signs in through the real browser login flow, opens the
 * populated WOW detail surface, verifies reflection/resonance affordances, and
 * writes safe local evidence under .hermes/qa-artifacts.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { config as loadDotenv } from "dotenv";
import { chromium } from "playwright";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import postgres from "postgres";

import { DEMO_SEED_KIND } from "../demo-seed-data";
import { resolveDemoUser, seedDemoRows } from "../seed-demo";
import {
  buildSafeEvidence,
  resolveSignedInWowDetailConfig,
  textMatcher,
} from "./wow-detail-signed-in-helpers";

loadDotenv({ path: ".env.local", override: false });
loadDotenv({ path: ".env", override: false });
loadDotenv({ path: ".env.development", override: false });

class AssertionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionFailed";
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionFailed(message);
}

function ok(label: string): void {
  console.log(`      ✓ ${label}`);
}

async function expectReachable(url: string, label: string): Promise<void> {
  const response = await fetch(url, { method: "GET" });
  assert(response.status < 500, `${label} returned HTTP ${response.status}`);
}

interface LoginBody {
  user: { id: string; email: string; name: string | null };
  token: string;
}

interface SeedSummary {
  userId: string;
  demoInspirationsBefore: number;
  demoWowMomentsBefore: number;
  seededDemoRows: boolean;
}

interface QaCheck {
  name: string;
  passed: boolean;
}

async function ensureSeededDemoAccount(config: ReturnType<typeof resolveSignedInWowDetailConfig>): Promise<SeedSummary> {
  const parsed = new URL(config.databaseUrl);
  const host = parsed.hostname.toLowerCase().replace(/^\[(.*)]$/, "$1");
  const sql = postgres(config.databaseUrl, {
    max: 1,
    prepare: false,
    ssl: ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host) || host.endsWith(".local") ? false : "require",
  });

  try {
    return await sql.begin(async (tx) => {
      const user = await resolveDemoUser(tx, {
        email: config.email,
        password: config.password,
        name: "WAKA WOW Detail QA",
        createUser: true,
      });
      const inspirationRows = await tx<Array<{ count: string | number }>>`
        select count(*) as count
        from inspirations
        where user_id = ${user.id}
          and kind = ${DEMO_SEED_KIND}
      `;
      const wowRows = await tx<Array<{ count: string | number }>>`
        select count(distinct wm.id) as count
        from wow_moments wm
        inner join wow_moment_inspirations wmi on wmi.wow_moment_id = wm.id
        inner join inspirations i on i.id = wmi.inspiration_id
        where wm.user_id = ${user.id}
          and wmi.user_id = ${user.id}
          and i.user_id = ${user.id}
          and i.kind = ${DEMO_SEED_KIND}
      `;
      const demoInspirationsBefore = Number(inspirationRows[0]?.count ?? 0);
      const demoWowMomentsBefore = Number(wowRows[0]?.count ?? 0);
      const shouldSeed = demoInspirationsBefore === 0 || demoWowMomentsBefore === 0;
      if (shouldSeed) await seedDemoRows(tx, user.id);
      return {
        userId: user.id,
        demoInspirationsBefore,
        demoWowMomentsBefore,
        seededDemoRows: shouldSeed,
      };
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function signIn(page: Page, config: ReturnType<typeof resolveSignedInWowDetailConfig>): Promise<LoginBody> {
  await page.goto(`${config.webUrl}/login`, { waitUntil: "domcontentloaded" });
  const tab = page.locator("#login-tab-login");
  if (await tab.isVisible().catch(() => false)) await tab.click();
  const responsePromise: Promise<Response> = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/auth/login",
    { timeout: config.timeoutMs },
  );
  await page.locator('input[name="email"]').fill(config.email);
  await page.locator('input[name="password"]').fill(config.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  const response = await responsePromise;
  assert(response.status() === 200, `Login failed with HTTP ${response.status()}`);
  const body = (await response.json()) as LoginBody;
  assert(body.user?.id && body.token, "Login response missing user or token");
  await page.waitForURL((url) => url.pathname === "/", { timeout: config.timeoutMs });
  return body;
}

async function openWowDetail(page: Page, timeoutMs: number): Promise<{ momentTitle: string; sourceCountText: string }> {
  const card = page.getByRole("button", { name: /Open mirror moment report/i }).first();
  await card.waitFor({ state: "visible", timeout: timeoutMs });
  const label = (await card.getAttribute("aria-label")) ?? "";
  await card.click();
  const detail = page.locator(".wow-moment-detail-panel--in-grid");
  await detail.waitFor({ state: "visible", timeout: timeoutMs });
  await detail.getByText("Reflection mode").waitFor({ timeout: timeoutMs });
  await detail.getByText("Where it came from").waitFor({ timeout: timeoutMs });
  await detail.getByText("Source trail").waitFor({ timeout: timeoutMs });
  const sourceCountText = ((await detail.locator(".wow-moment-source-count").first().textContent()) ?? "").trim();
  assert(/^[23] sources?$/.test(sourceCountText), `Expected 2-3 source inspirations, saw "${sourceCountText}"`);

  const sourceLabels = detail.locator(".wow-moment-detail-sources .wow-moment-related-label");
  const sourceLabelCount = await sourceLabels.count();
  assert(sourceLabelCount >= 2 && sourceLabelCount <= 3, `Expected 2-3 source role labels, saw ${sourceLabelCount}`);

  const sourceQuotes = detail.locator(".wow-moment-detail-sources blockquote");
  const sourceQuoteCount = await sourceQuotes.count();
  assert(sourceQuoteCount >= 2 && sourceQuoteCount <= 3, `Expected 2-3 source text blocks, saw ${sourceQuoteCount}`);
  assert(sourceQuoteCount === sourceLabelCount, `Expected source labels and text blocks to match, saw ${sourceLabelCount} labels and ${sourceQuoteCount} text blocks`);
  for (let i = 0; i < sourceQuoteCount; i += 1) {
    const sourceQuote = sourceQuotes.nth(i);
    assert(await sourceQuote.isVisible(), `Expected source text block ${i + 1} to be visible`);
    const sourceText = ((await sourceQuote.textContent()) ?? "").trim();
    assert(sourceText.length > 40, `Expected full source text ${i + 1} to be visible in detail evidence`);
    assert(!sourceText.endsWith("…"), `Expected source text ${i + 1} not to end with an ellipsis`);
  }
  return {
    momentTitle: label.replace(/^Open mirror moment report:\s*/i, "") || "unknown WOW moment",
    sourceCountText,
  };
}

async function verifyResonance(page: Page, timeoutMs: number): Promise<QaCheck[]> {
  const detail = page.locator(".wow-moment-detail-panel--in-grid");
  await detail.getByRole("button", { name: /That’s me|Partly|Not quite/i }).first().click();
  await detail.getByText(textMatcher(["Remember this about me?", "Save this as a future memory?"])).waitFor({ timeout: timeoutMs });

  const checks: QaCheck[] = [];
  const labels = [
    ["Remember this about me?", "Save this as a future memory?"],
    ["Remember this", "Mark locally"],
    ["Edit first"],
    ["Not for me"],
    ["Add more signal for this pattern"],
    ["Add Signal", "Add another inspiration"],
  ];
  for (const alternatives of labels) {
    const matcher = textMatcher(alternatives);
    const visible = await detail.getByText(matcher).first().isVisible().catch(() => false);
    assert(visible, `Expected visible text matching ${alternatives.join(" or ")}`);
    checks.push({ name: alternatives[0]!, passed: true });
  }
  return checks;
}

async function writeEvidence(params: {
  config: ReturnType<typeof resolveSignedInWowDetailConfig>;
  page: Page;
  login: LoginBody;
  seed: SeedSummary;
  momentTitle: string;
  sourceCountText: string;
  checks: QaCheck[];
}): Promise<string> {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = join(params.config.artifactDir, runId);
  await mkdir(runDir, { recursive: true });
  await params.page.screenshot({ path: join(runDir, "wow-detail.png"), fullPage: true });
  const evidence = buildSafeEvidence(params.config, {
    userId: params.login.user.id,
    seededDemoRows: params.seed.seededDemoRows,
    demoInspirationsBefore: params.seed.demoInspirationsBefore,
    demoWowMomentsBefore: params.seed.demoWowMomentsBefore,
    momentTitle: params.momentTitle,
    sourceCountText: params.sourceCountText,
    checks: params.checks,
    screenshot: join(runDir, "wow-detail.png"),
  });
  await writeFile(join(runDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  return runDir;
}

async function run(): Promise<void> {
  const config = resolveSignedInWowDetailConfig();
  console.log(`web=${config.webUrl}`);
  console.log(`api=${config.apiOrigin}`);
  console.log(`qa email=${config.email}`);
  console.log(`credentials=${config.credentialsGenerated ? "generated" : "provided"} (password not printed)`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  try {
    await expectReachable(config.webUrl, "web app");
    await expectReachable(`${config.apiOrigin}/api/health`, "api health");
    ok("local endpoints reachable");

    const seed = await ensureSeededDemoAccount(config);
    ok(seed.seededDemoRows ? "seeded demo WOW rows for QA user" : "reused existing demo WOW rows for QA user");

    browser = await chromium.launch({ headless: !config.headful });
    context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(config.timeoutMs);
    page.setDefaultNavigationTimeout(config.timeoutMs);

    const login = await signIn(page, config);
    ok(`signed in as ${login.user.email} (${login.user.id})`);

    const detail = await openWowDetail(page, config.timeoutMs);
    ok(`opened populated WOW detail: ${detail.momentTitle} (${detail.sourceCountText})`);

    const checks = await verifyResonance(page, config.timeoutMs);
    ok(`verified reflection/resonance ending checks: ${checks.map((check) => check.name).join(", ")}`);

    const evidenceDir = await writeEvidence({
      config,
      page,
      login,
      seed,
      ...detail,
      checks,
    });
    ok(`safe evidence written to ${evidenceDir}`);
    console.log("\nSIGNED-IN WOW DETAIL QA PASSED ✅");
  } catch (error) {
    console.error("\nSIGNED-IN WOW DETAIL QA FAILED");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  }
}

void run();
