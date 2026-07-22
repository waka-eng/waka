#!/usr/bin/env tsx
/** Signed-in Top-of-Mind delete durability browser/API/DB smoke. */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { config as loadDotenv } from "dotenv";
import { chromium, type Browser, type BrowserContext, type Page, type Response } from "playwright";
import postgres from "postgres";

import * as schema from "../../packages/api/src/db/index.js";
import {
  feedback,
  inspirations,
  users,
  wowMomentInspirations,
  wowMoments,
} from "../../packages/api/src/db/index.js";
import { persistTopOfMindRevision } from "../../packages/api/src/lib/top-of-mind-persistence.js";

loadDotenv({ path: process.env.WAKA_API_DOTENV_PATH ?? ".env.local" });

const WEB_URL = (process.env.WAKA_WEB_URL ?? "http://localhost:3010").replace(/\/$/, "");
const API_URL = (process.env.WAKA_API_URL ?? WEB_URL).replace(/\/$/, "");
const TIMEOUT_MS = 30_000;
const PASSWORD = "top-of-mind-delete-e2e-password";

interface AuthBody {
  user: { id: string; email: string; name: string };
  token: string;
}

interface TopOfMindListBody {
  topOfMindNotes: Array<{ id: string; title: string }>;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function signUp(page: Page, email: string, name: string): Promise<AuthBody> {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#login-tab-signup").click();
  const responsePromise: Promise<Response> = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/auth/signup",
    { timeout: TIMEOUT_MS },
  );
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('input[name="name"]').fill(name);
  await page.getByRole("button", { name: /create account/i }).click();
  const response = await responsePromise;
  assert(response.status() === 201, `Signup failed: ${response.status()} ${await response.text()}`);
  const body = (await response.json()) as AuthBody;
  assert(body.token && body.user?.id, "Signup response did not include an auth token and user id");
  await page.waitForURL((url) => url.pathname === "/", { timeout: TIMEOUT_MS });
  return body;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${WEB_URL}/login`, { waitUntil: "domcontentloaded" });
  const loginTab = page.locator("#login-tab-login");
  if (await loginTab.isVisible().catch(() => false)) await loginTab.click();
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/auth/login",
    { timeout: TIMEOUT_MS },
  );
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  const response = await responsePromise;
  assert(response.status() === 200, `Login failed: ${response.status()} ${await response.text()}`);
  await page.waitForURL((url) => url.pathname === "/", { timeout: TIMEOUT_MS });
}

async function authorizedJson<T>(path: string, token: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: response.status, body: (await response.json()) as T };
}

async function run(): Promise<void> {
  const connectionUrl = process.env.DB_CONNECTION_URL;
  assert(connectionUrl, "DB_CONNECTION_URL is required");

  const suffix = uniqueSuffix();
  const email = `top-of-mind-delete-${suffix}@example.test`;
  const displayName = `Delete QA ${suffix}`;
  const title = `delete durability ${suffix}`;
  const semanticKey = `delete-durability:${suffix}`;
  const baselineFingerprint = `baseline:${suffix}`;
  const evidenceIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const artifactDir = join(".hermes", "qa-artifacts", `top-of-mind-delete-${suffix}`);

  const client = postgres(connectionUrl, { max: 3, prepare: false });
  const db = drizzle(client, { schema });
  let browser: Browser | null = null;
  let auth: AuthBody | null = null;
  let noteId: string | null = null;

  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(TIMEOUT_MS);
    page.setDefaultNavigationTimeout(TIMEOUT_MS);

    console.log("[1/7] Sign up through the real browser flow");
    auth = await signUp(page, email, displayName);

    console.log("[2/7] Seed one disposable persisted note and its evidence");
    await db.insert(inspirations).values(
      evidenceIds.map((id, index) => ({
        id,
        userId: auth!.user.id,
        text: `delete durability evidence ${index + 1} ${suffix}`,
        kind: "note",
      })),
    );
    const [note] = await db
      .insert(wowMoments)
      .values({
        userId: auth.user.id,
        title,
        kind: "tension",
        why: "Disposable browser QA note for durable deletion.",
        wowScore: 80,
        semanticKey,
        evidenceFingerprint: baselineFingerprint,
        idempotencyKey: `top-of-mind-delete-e2e:${suffix}`,
      })
      .returning();
    assert(note, "Failed to seed the Top-of-Mind note");
    noteId = note.id;
    await db.insert(wowMomentInspirations).values(
      evidenceIds.map((inspirationId, sortOrder) => ({
        userId: auth!.user.id,
        wowMomentId: note.id,
        inspirationId,
        role: "Evidence signal",
        reason: "Disposable browser QA evidence",
        sortOrder,
      })),
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    const noteCard = page.locator(".nc-note").filter({ hasText: title });
    await noteCard.waitFor({ state: "visible" });
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: join(artifactDir, "before-delete.png"), fullPage: true });

    console.log("[3/7] Delete through the post-it control and verify immediate removal");
    const feedbackResponsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/feedback",
      { timeout: TIMEOUT_MS },
    );
    await noteCard.locator(".nc-note-icon-btn--delete").click();
    await noteCard.waitFor({ state: "detached" });
    const feedbackResponse = await feedbackResponsePromise;
    assert(
      feedbackResponse.status() === 201,
      `Delete feedback failed: ${feedbackResponse.status()} ${await feedbackResponse.text()}`,
    );
    await page.screenshot({ path: join(artifactDir, "after-delete.png"), fullPage: true });

    console.log("[4/7] Verify durable feedback plus API list/detail exclusion");
    const rows = await db
      .select({ targetId: feedback.targetId, value: feedback.value })
      .from(feedback)
      .where(
        and(
          eq(feedback.userId, auth.user.id),
          eq(feedback.targetType, "top_of_mind_note"),
          eq(feedback.targetId, note.id),
        ),
      );
    assert(rows.some((row) => row.value === "not_true"), "No durable not_true feedback row was stored");
    const list = await authorizedJson<TopOfMindListBody>("/api/top-of-mind", auth.token);
    assert(list.status === 200, `List returned ${list.status}`);
    assert(!list.body.topOfMindNotes.some((item) => item.id === note.id), "Deleted note remained in API list");
    const detail = await authorizedJson<{ error?: string }>(`/api/top-of-mind/${note.id}`, auth.token);
    assert(detail.status === 404, `Deleted note detail returned ${detail.status}, expected 404`);

    console.log("[5/7] Verify hard refresh and a fresh browser session stay empty");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(".nc-stage--top-of-mind-wall").waitFor({ state: "visible" });
    assert((await page.locator(".nc-note").filter({ hasText: title }).count()) === 0, "Hard refresh restored the note");
    await context.close();
    const freshContext: BrowserContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    freshPage.setDefaultTimeout(TIMEOUT_MS);
    await signIn(freshPage, email);
    await freshPage.locator(".nc-stage--top-of-mind-wall").waitFor({ state: "visible" });
    assert(
      (await freshPage.locator(".nc-note").filter({ hasText: title }).count()) === 0,
      "A new authenticated browser session restored the note",
    );
    await freshContext.close();

    console.log("[6/7] Re-run persistence with reordered/subset evidence and assert zero writes");
    const familyBefore = await db.select().from(wowMoments).where(eq(wowMoments.semanticKey, semanticKey));
    const linksBefore = await db
      .select()
      .from(wowMomentInspirations)
      .where(eq(wowMomentInspirations.wowMomentId, note.id));
    let createAttempts = 0;
    for (const [fingerprint, candidateEvidence] of [
      [`reordered:${suffix}`, [...evidenceIds].reverse()],
      [`subset:${suffix}`, evidenceIds.slice(0, 2)],
    ] as const) {
      const regenerated = await persistTopOfMindRevision({
        db,
        userId: auth.user.id,
        semanticKey,
        evidenceFingerprint: fingerprint,
        evidenceIds: candidateEvidence,
        value: 100,
        createRevision: async () => {
          createAttempts += 1;
          throw new Error("Suppressed regeneration attempted to create a revision");
        },
      });
      assert(regenerated.action === "keep_existing", `Regeneration returned ${regenerated.action}`);
      assert(regenerated.note.id === note.id, "Regeneration returned a different note revision");
    }
    const familyAfter = await db.select().from(wowMoments).where(eq(wowMoments.semanticKey, semanticKey));
    const linksAfter = await db
      .select()
      .from(wowMomentInspirations)
      .where(eq(wowMomentInspirations.wowMomentId, note.id));
    assert(createAttempts === 0, `Suppressed regeneration made ${createAttempts} create attempt(s)`);
    assert(familyAfter.length === familyBefore.length, "Suppressed regeneration inserted a note row");
    assert(linksAfter.length === linksBefore.length, "Suppressed regeneration inserted an evidence link");

    console.log("[7/7] Write redacted evidence summary");
    const evidence = {
      noteId: note.id,
      immediateRemoval: true,
      feedbackValue: "not_true",
      listExcluded: true,
      detailStatus: detail.status,
      hardRefreshExcluded: true,
      freshSessionExcluded: true,
      regenerationActions: ["keep_existing", "keep_existing"],
      noteRowsBefore: familyBefore.length,
      noteRowsAfter: familyAfter.length,
      linksBefore: linksBefore.length,
      linksAfter: linksAfter.length,
    };
    await writeFile(join(artifactDir, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`PASS: ${artifactDir}`);
  } finally {
    try {
      const removed = await db
        .delete(users)
        .where(eq(users.email, email))
        .returning({ id: users.id });
      if (auth && removed.length !== 1) {
        console.warn(`[cleanup] expected one disposable user, removed ${removed.length}`);
      }
    } catch (error) {
      console.warn(
        `[cleanup] failed to remove disposable user: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (browser) await browser.close().catch(() => undefined);
    await client.end({ timeout: 2 }).catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
