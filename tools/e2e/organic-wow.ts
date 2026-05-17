#!/usr/bin/env tsx
/**
 * Organic WOW end-to-end smoke.
 *
 * Signs into an existing local/dev account, optionally removes curated demo seed
 * rows for that account, captures related organic inspirations through the UI,
 * then waits for classification/background WOW generation and proves at least
 * one returned WOW moment links back to the run-marker organic rows.
 */
import "dotenv/config";

import { chromium } from "playwright";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import postgres from "postgres";

import {
  assertLocalDatabase,
  replacePriorDemoRows,
  resolveDemoUser,
} from "../seed-demo";

const WEB_URL = (process.env.WAKA_WEB_URL ?? "http://localhost:5173").replace(/\/$/, "");
const API_URL = (process.env.WAKA_API_URL ?? "http://localhost:3001").replace(/\/$/, "");
const EMAIL = process.env.WAKA_ORGANIC_EMAIL;
const PASSWORD = process.env.WAKA_ORGANIC_PASSWORD;
const TIMEOUT_MS = Number.parseInt(process.env.WAKA_ORGANIC_TIMEOUT_MS ?? "240000", 10);
const POLL_MS = 2_000;
const NAV_TIMEOUT_MS = 30_000;
const CAPTURE_COUNT = 4;

class AssertionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionFailed";
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionFailed(message);
}

function step(label: string, n: number, total: number): void {
  console.log(`[${n}/${total}] ${label}`);
}

function ok(label: string): void {
  console.log(`      ✓ ${label}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runMarker(): string {
  return `organic-wow-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function expectReachable(url: string, label: string): Promise<void> {
  const response = await fetch(url, { method: "GET" });
  assert(response.status < 500, `${label} ${url} returned ${response.status}`);
}

interface LoginBody {
  user: { id: string; email: string; name: string | null };
  token: string;
}

interface InspirationRow {
  id: string;
  userId: string;
  text: string;
  kind: string | null;
  cluster: string | null;
  classifiedAt?: string | null;
}

interface WowMomentRow {
  id: string;
  userId: string;
  title: string;
  relatedInspirations: Array<{
    inspirationId: string;
    text: string;
    kind: string | null;
  }>;
}

interface WowStatusRow {
  inspiration: {
    id: string;
    textPreview: string;
    cluster: string | null;
    classifiedAt: string | null;
  };
  embedded: boolean;
  linkedWowMomentCount: number;
  job: { status: string; attempts: number; maxAttempts: number } | null;
  debugReason: { code?: string; label?: string; detail?: string };
}

async function apiJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status !== 200) {
    const body = await response.text();
    throw new AssertionFailed(`GET ${path} expected 200, got ${response.status}: ${body}`);
  }
  return (await response.json()) as T;
}

async function cleanupDemoSeedRows(email: string): Promise<void> {
  if (process.env.WAKA_ORGANIC_CLEANUP_DEMO_DATA !== "1") return;
  const databaseUrl = process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
  assert(databaseUrl, "WAKA_ORGANIC_CLEANUP_DEMO_DATA=1 requires DB_CONNECTION_URL or DATABASE_URL");
  const allowRemote = process.env.WAKA_ORGANIC_ALLOW_REMOTE === "1";
  assertLocalDatabase(databaseUrl, allowRemote);
  const parsed = new URL(databaseUrl);
  const sql = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    ssl: ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(parsed.hostname) || parsed.hostname.endsWith(".local") ? false : "require",
  });
  try {
    const cleanup = await sql.begin(async (tx) => {
      const user = await resolveDemoUser(tx, {
        email,
        name: "WAKA Organic Smoke",
        createUser: false,
      });
      return replacePriorDemoRows(tx, user.id);
    });
    ok(
      `demo cleanup removed ${cleanup.deletedDemoInspirations} demo inspirations and ${cleanup.deletedDemoWowMoments} demo-only WOW moments`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function signIn(page: Page): Promise<LoginBody> {
  assert(EMAIL && PASSWORD, "WAKA_ORGANIC_EMAIL and WAKA_ORGANIC_PASSWORD are required");
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#login-tab-login").click();
  const loginResponsePromise: Promise<Response> = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/auth/login",
    { timeout: NAV_TIMEOUT_MS },
  );
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  const loginResponse = await loginResponsePromise;
  assert(loginResponse.status() === 200, `Login failed: ${loginResponse.status()} ${await loginResponse.text()}`);
  const body = (await loginResponse.json()) as LoginBody;
  assert(body.token && body.user?.id, "Login response missing token or user id");
  await page.waitForURL((u) => u.pathname === "/", { timeout: NAV_TIMEOUT_MS });
  return body;
}

function noteTexts(marker: string): string[] {
  return [
    [
      `Field diary ${marker}: I keep watching Maya lose the thread after offline site visits; she records soil sensor anomalies, hallway quotes, and half-finished sketches, but by the time the train reconnects she cannot remember which observation changed her mind.`,
      "The inspiration is not another capture box — it is a local memory layer that preserves the context around an interruption so the next review starts where the field researcher actually left off.",
    ].join("\n"),
    [
      `Trust concern ${marker}: the same researcher refuses to upload raw interviews until consent language is checked, yet she still needs yesterday's private notes to surface beside today's lab hunches.`,
      "A useful assistant would do privacy-preserving recall on-device first, making the boundary between personal memory and shareable evidence explicit instead of treating retrieval as an all-or-nothing cloud feature.",
    ].join("\n"),
    [
      `Design constraint ${marker}: selective sync should carry provenance with every fragment — who said it, which notebook page or photo it came from, and whether it is safe to cite — because a beautiful synthesis is useless if the team cannot trace it back.`,
      "This creates a productive tension: the system should bridge related clues across devices while keeping unsynced sensitive material local until the user deliberately promotes it.",
    ].join("\n"),
    [
      `Behavior pattern ${marker}: after each offline visit, Maya manually reopens the same three notes — the consent worry, the sensor anomaly, and the sketch of the shared dashboard — before writing a plan for the next interview.`,
      "That recurrence reveals the WOW moment: connect repeated review behavior into a non-duplicate bridge showing that local trust controls, provenance, and field-context recovery are one workflow rather than three separate features.",
    ].join("\n"),
  ];
}

async function captureOrganicNotes(page: Page, marker: string): Promise<string[]> {
  const ids: string[] = [];
  const captureNote = page.locator("#capNote");
  if (!(await captureNote.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Inspiration First", exact: true }).click();
  }
  await captureNote.waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });

  for (const text of noteTexts(marker)) {
    await captureNote.fill(text);
    const postPromise: Promise<Response> = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/inspirations",
      { timeout: NAV_TIMEOUT_MS },
    );
    await page.locator("#capSave").click();
    const response = await postPromise;
    assert(response.status() === 201, `POST /api/inspirations expected 201, got ${response.status()}: ${await response.text()}`);
    const body = (await response.json()) as { inspiration: InspirationRow };
    assert(body.inspiration.text.includes(marker), "Captured inspiration response did not include run marker");
    assert(body.inspiration.kind !== "demo-seed", "Organic capture must not create demo-seed rows");
    ids.push(body.inspiration.id);
    console.log(`      … captured ${body.inspiration.id}`);
    await page.locator("#capConfirm.visible").filter({ hasText: /Saved/i }).first().waitFor({ timeout: 5_000 }).catch(() => undefined);
  }
  return ids;
}

async function pollUntil<T>(label: string, timeoutMs: number, fn: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const result = await fn();
    if (result) {
      console.log(`      … ${label} ready after ${attempts} poll(s)`);
      return result;
    }
    if (attempts % 10 === 0) console.log(`      … waiting for ${label} (poll #${attempts})`);
    await sleep(POLL_MS);
  }
  throw new AssertionFailed(`Timed out after ${timeoutMs} ms waiting for ${label}`);
}

async function waitForRows(token: string, ids: string[]): Promise<InspirationRow[]> {
  return pollUntil("captured rows", TIMEOUT_MS, async () => {
    const body = await apiJson<{ inspirations: InspirationRow[] }>("/api/inspirations", token);
    const byId = new Map(body.inspirations.map((row) => [row.id, row]));
    const rows = ids.map((id) => byId.get(id));
    if (rows.some((row) => !row)) return null;
    return rows as InspirationRow[];
  });
}

async function waitForClassified(token: string, ids: string[]): Promise<InspirationRow[]> {
  return pollUntil("classification", TIMEOUT_MS, async () => {
    const rows = await waitForRows(token, ids);
    if (rows.every((row) => row.cluster && row.classifiedAt)) return rows;
    return null;
  });
}

async function waitForStatus(token: string, ids: string[]): Promise<WowStatusRow[]> {
  return pollUntil("WOW status/job completion", TIMEOUT_MS, async () => {
    const body = await apiJson<{ rows: WowStatusRow[] }>(`/api/wow-status?limit=50`, token);
    const rows = body.rows.filter((row) => ids.includes(row.inspiration.id));
    if (rows.length < ids.length) return null;
    const terminal = rows.every((row) => {
      const status = row.job?.status;
      return row.linkedWowMomentCount > 0 || status === "succeeded" || status === "failed";
    });
    return terminal ? rows : null;
  });
}

function organicWowMatch(moment: WowMomentRow, ids: string[], marker: string): { idMatches: number; markerMatches: number } {
  const idSet = new Set(ids);
  const idMatches = moment.relatedInspirations.filter((related) => idSet.has(related.inspirationId)).length;
  const markerMatches = moment.relatedInspirations.filter((related) => related.text.includes(marker)).length;
  return { idMatches, markerMatches };
}

async function waitForOrganicWow(token: string, ids: string[], marker: string): Promise<WowMomentRow> {
  return pollUntil("organic WOW moment", TIMEOUT_MS, async () => {
    const body = await apiJson<{ wowMoments: WowMomentRow[] }>("/api/wow-moments", token);
    for (const moment of body.wowMoments) {
      const match = organicWowMatch(moment, ids, marker);
      if (moment.relatedInspirations.every((related) => related.kind !== "demo-seed") && (match.idMatches >= 2 || match.markerMatches >= 2)) {
        return moment;
      }
    }
    return null;
  });
}

async function run(): Promise<void> {
  assert(EMAIL && PASSWORD, "WAKA_ORGANIC_EMAIL and WAKA_ORGANIC_PASSWORD are required");
  const marker = runMarker();
  console.log(`web=${WEB_URL}  api=${API_URL}`);
  console.log(`organic email=${EMAIL}`);
  console.log(`run marker=${marker}`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let token: string | null = null;
  let capturedIds: string[] = [];
  let statusRows: WowStatusRow[] = [];

  try {
    step("API and web are reachable", 1, 7);
    await expectReachable(`${API_URL}/api/health`, "api health");
    await expectReachable(WEB_URL, "web");
    ok("endpoints reachable");

    step("Sign in through existing account login UI", 2, 7);
    browser = await chromium.launch();
    context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
    const login = await signIn(page);
    token = login.token;
    ok(`signed in as ${login.user.email} (${login.user.id})`);

    step("Optionally remove curated demo seed rows for this account", 3, 7);
    await cleanupDemoSeedRows(login.user.email);
    if (process.env.WAKA_ORGANIC_CLEANUP_DEMO_DATA !== "1") ok("demo cleanup skipped");

    step("Capture related organic inspirations through the UI", 4, 7);
    capturedIds = await captureOrganicNotes(page, marker);
    ok(`captured ${capturedIds.length} organic inspirations`);

    step("Poll until captured rows are visible and tenant-scoped", 5, 7);
    const visibleRows = await waitForRows(token, capturedIds);
    for (const row of visibleRows) {
      assert(row.userId === login.user.id, `Tenant mismatch for ${row.id}: ${row.userId} vs ${login.user.id}`);
      assert(row.text.includes(marker), `Visible row ${row.id} is missing run marker`);
      assert(row.kind !== "demo-seed", `Visible row ${row.id} unexpectedly has demo-seed kind`);
    }
    ok("all captured rows visible for signed-in user");

    step("Wait for classification and background WOW job terminal status", 6, 7);
    const classifiedRows = await waitForClassified(token, capturedIds);
    ok(`classified rows: ${classifiedRows.map((row) => `${row.id.slice(0, 8)}:${row.cluster}`).join(", ")}`);
    statusRows = await waitForStatus(token, capturedIds);
    ok(`WOW status rows terminal/linked: ${statusRows.map((row) => `${row.inspiration.id.slice(0, 8)}:${row.debugReason.code ?? row.job?.status ?? "unknown"}`).join(", ")}`);

    step("Assert at least one WOW moment is organically linked to run-marker rows", 7, 7);
    const wow = await waitForOrganicWow(token, capturedIds, marker);
    const match = organicWowMatch(wow, capturedIds, marker);
    ok(`organic WOW ${wow.id} matched ${match.idMatches} captured ids / ${match.markerMatches} marker texts`);

    console.log("\nORGANIC WOW E2E PASSED ✅");
  } catch (error) {
    console.error("\nORGANIC WOW E2E FAILED");
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Diagnostics (safe):", {
      marker,
      capturedIds,
      statusRows: statusRows.map((row) => ({
        id: row.inspiration.id,
        cluster: row.inspiration.cluster,
        classifiedAt: row.inspiration.classifiedAt,
        embedded: row.embedded,
        linkedWowMomentCount: row.linkedWowMomentCount,
        jobStatus: row.job?.status ?? null,
        debugCode: row.debugReason.code ?? null,
      })),
      tokenPresent: Boolean(token),
    });
    process.exitCode = 1;
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  }
}

void run();
