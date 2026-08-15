/**
 * Exercises the queue's conflict semantics against a real Postgres.
 *
 * The unit suite mocks the database, so the two behaviours that matter most
 * here are invisible to it: whether `(xmax = 0)` actually distinguishes an
 * insert from a conflict update, and whether a terminal job re-arms rather
 * than being suppressed forever. Both are SQL-level facts, and both have
 * already been wrong once.
 *
 *   pnpm tsx packages/api/scripts/verify-enqueue.ts
 */

import { fileURLToPath } from "node:url";

import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)) });
process.env.JWT_SECRET ??= "verify-only-secret";

const { eq } = await import("drizzle-orm");
const { accounts, backgroundJobs, profiles } = await import("../src/db/index.js");
const { getDb } = await import("../src/lib/db.js");
const { enqueueDeriveSignals, enqueueTopOfMindRefresh } = await import("../src/lib/queue.js");

const db = getDb();
const [account] = await db
  .insert(accounts)
  .values({ email: `verify-${Date.now()}@test.local` })
  .returning();
const [profile] = await db
  .insert(profiles)
  .values({ accountId: account!.id, type: "human", name: "Verify" })
  .returning();

const inspirationId = "00000000-0000-4000-8000-000000000001";

const first = await enqueueDeriveSignals(profile!.id, inspirationId, "created");
const duplicate = await enqueueDeriveSignals(profile!.id, inspirationId, "created");
console.log(`1. first enqueue: created=${first.created} (expect true)`);
console.log(
  `2. duplicate while pending: created=${duplicate.created} sameJob=${first.jobId === duplicate.jobId} (expect false / true)`,
);

await db
  .update(backgroundJobs)
  .set({ status: "succeeded", attempts: 3, lastError: "stale failure" })
  .where(eq(backgroundJobs.id, first.jobId));

const rearmed = await enqueueDeriveSignals(profile!.id, inspirationId, "created");
const [row] = await db.select().from(backgroundJobs).where(eq(backgroundJobs.id, first.jobId));
console.log(
  `3. after success: status=${row!.status} attempts=${row!.attempts} lastError=${row!.lastError} sameRow=${rearmed.jobId === first.jobId} (expect pending / 0 / null / true)`,
);

const refreshA = await enqueueTopOfMindRefresh(profile!.id, "signals_changed");
const refreshB = await enqueueTopOfMindRefresh(profile!.id, "manual");
console.log(
  `4. artifact refresh: first created=${refreshA.created} second created=${refreshB.created} coalesced=${refreshA.jobId === refreshB.jobId} (expect true / false / true)`,
);

await db.delete(accounts).where(eq(accounts.id, account!.id));
console.log("5. cleanup ok");
process.exit(0);
