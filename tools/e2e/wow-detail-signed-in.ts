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
      await tx`
        update users
        set onboarding_completed_at = coalesce(onboarding_completed_at, now()),
            updated_at = now()
        where id = ${user.id}
      `;

      const inspirationRows = await tx<Array<{ count: string | number }>>`
        select count(*) as count
        from signals
        where user_id = ${user.id}
          and kind = ${DEMO_SEED_KIND}
      `;
      const wowRows = await tx<Array<{ count: string | number }>>`
        select count(distinct wm.id) as count
        from top_of_mind_notes wm
        inner join top_of_mind_note_signals wmi on wmi.top_of_mind_note_id = wm.id
        inner join signals i on i.id = wmi.signal_id
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
  await page.getByRole("region", { name: /Five Top of Mind post-its/i }).waitFor({ state: "visible", timeout: timeoutMs });

  const sourceButton = page.getByRole("button", { name: /inspirations led here/i }).first();
  await sourceButton.waitFor({ state: "visible", timeout: timeoutMs });
  const sourceCountText = ((await sourceButton.textContent()) ?? "").trim();
  assert(/^[3-5] inspirations led here$/.test(sourceCountText), `Expected 3-5 source inspirations, saw "${sourceCountText}"`);

  const note = sourceButton.locator("xpath=ancestor::article[1]");
  const momentTitle = ((await note.locator(".nc-note-body").first().textContent()) ?? "").trim() || "unknown top-of-mind note";

  await sourceButton.click();
  const detail = page.locator(".memory-drawer-stack");
  await detail.waitFor({ state: "visible", timeout: timeoutMs });
  await detail.getByRole("button", { name: /top of mind\s+[3-5]/i }).waitFor({ state: "visible", timeout: timeoutMs });

  const sourceItems = detail.locator(".memory-contents-item");
  const sourceItemCount = await sourceItems.count();
  assert(sourceItemCount >= 3 && sourceItemCount <= 5, `Expected 3-5 source items, saw ${sourceItemCount}`);
  for (let i = 0; i < sourceItemCount; i += 1) {
    const sourceItem = sourceItems.nth(i);
    assert(await sourceItem.isVisible(), `Expected source item ${i + 1} to be visible`);
    const sourceText = ((await sourceItem.textContent()) ?? "").trim();
    assert(sourceText.length > 40, `Expected full source text ${i + 1} to be visible in detail evidence`);
    assert(!sourceText.endsWith("…"), `Expected source text ${i + 1} not to end with an ellipsis`);
  }

  return { momentTitle, sourceCountText };
}

async function verifyEvidenceDrawer(page: Page, timeoutMs: number): Promise<QaCheck[]> {
  const detail = page.locator(".memory-drawer-stack");
  const checks: QaCheck[] = [];

  const textLabels = ["top of mind", "all saved", "recently saved"];
  for (const label of textLabels) {
    const visible = await detail.getByText(label).first().isVisible().catch(() => false);
    assert(visible, `Expected visible text "${label}"`);
    checks.push({ name: label, passed: true });
  }

  const backHomeVisible = await page.getByRole("button", { name: /back home/i }).first().isVisible().catch(() => false);
  assert(backHomeVisible, "Expected visible action \"back home\"");
  checks.push({ name: "action: back home", passed: true });

  await page.getByRole("button", { name: /back home/i }).first().click();
  await detail.waitFor({ state: "hidden", timeout: timeoutMs });
  checks.push({ name: "back home closes source drawer", passed: true });

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

    const checks = await verifyEvidenceDrawer(page, config.timeoutMs);
    ok(`verified top-of-mind evidence drawer checks: ${checks.map((check) => check.name).join(", ")}`);

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
