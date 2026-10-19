/** Deleting a signal reconciles the principles that cited it — real SQL, no model. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { getDb } from "../lib/db.js";
import type { AuthEnv } from "../lib/middleware.js";
import { createSignalRoutes, deleteProfileSignal } from "./signals.js";

let t: TestDatabase;
let sequence = 0;

async function person() {
  const [a] = await t.sql`INSERT INTO accounts(email) VALUES (${`signal-delete-${sequence++}@example.test`}) RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${a.id},'human','Test') RETURNING id`;
  return { profileId: p.id as string, accountId: a.id as string };
}

/** Three active, evidenced signals and a principle citing all of them. */
async function principleOnThreeSignals(profileId: string, locked: boolean) {
  const ids: string[] = [];
  for (let n = 0; n < 3; n++) {
    const [s] = await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${profileId},${`Pattern ${n}`}) RETURNING id`;
    for (let i = 0; i < 3; i++) {
      const [ins] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profileId},'raw') RETURNING id`;
      await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
        VALUES (${profileId},${profileId},${s.id},${ins.id})`;
    }
    await t.sql`UPDATE signals SET status='active' WHERE id=${s.id}`;
    ids.push(s.id as string);
  }
  const [p] = await t.sql`INSERT INTO principles(profile_id, statement, state, origin, rank, locked_at, held_since)
    VALUES (${profileId}, 'Prefer small, reversible experiments.', 'held', 'minted', 1,
      CASE WHEN ${locked} THEN now() END, now()) RETURNING id`;
  for (const id of ids) {
    await t.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id) VALUES (${profileId},${p.id},${id})`;
  }
  return { principleId: p.id as string, signalIds: ids };
}

function app(owner: { profileId: string; accountId: string }) {
  const routes = new Hono<AuthEnv>();
  routes.route("/api/signals", createSignalRoutes({
    getDatabase: () => t.db as never,
    requestRefresh: async () => ({ jobId: randomUUID(), requestVersion: "1", created: true }) as never,
    authMiddleware: async (c, next) => {
      c.set("session", { sessionId: randomUUID(), account: { id: owner.accountId, email: "o@example.test" },
        profile: { id: owner.profileId, accountId: owner.accountId, type: "human", name: "Owner", preferredLocale: "en-US" } } as never);
      await next();
    },
  }));
  return routes;
}

/**
 * A principle edit's lock order — the principle row, then the profile's
 * generation fence — held open while `act` runs on the app pool. The act must
 * not take the fence and then wait on the principle (a deadlock); it may wait
 * on the principle only after its own signal transaction has committed.
 */
async function racePrincipleEdit(profileId: string, principleId: string, signalId: string, act: () => Promise<unknown>) {
  let acting: Promise<unknown> | undefined;
  await t.sql.begin(async (edit) => {
    await edit`SET LOCAL lock_timeout = '5s'`;
    await edit`SELECT id FROM principles WHERE id=${principleId} FOR UPDATE`;
    acting = act();
    await vi.waitFor(async () => {
      /* someone waits on THIS transaction (pg_locks, not pg_stat_activity:
         the stats view is a snapshot frozen for the rest of the transaction) */
      const [row] = await edit`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted
        AND locktype = 'transactionid' AND transactionid::text = pg_current_xact_id()::text`;
      expect(row!.n).toBeGreaterThan(0);
    }, { timeout: 5000, interval: 20 });
    /* the signal's own transaction committed before anything waited on the
       principle — so it holds no fence while it waits */
    expect(await edit`SELECT id FROM signals WHERE id=${signalId}`, "the signal change committed first").toHaveLength(0);
    await edit`UPDATE generation_revisions SET revision = revision + 1 WHERE profile_id=${profileId}`;
  });
  return acting;
}

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
  process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = "0";
});
afterAll(async () => { await getDb().$client.end(); await t?.cleanup(); });

describe("DELETE /api/signals/:signalId reconciles principles", () => {
  it("withdraws support from a human-worded principle that cited the deleted signal", async () => {
    const owner = await person();
    const { principleId, signalIds } = await principleOnThreeSignals(owner.profileId, true);

    const response = await app(owner).request(`/api/signals/${signalIds[0]}`, { method: "DELETE" });
    expect(response.status).toBe(200);

    const [row] = await t.sql`SELECT state, unsupported_at, statement FROM principles WHERE id=${principleId}`;
    expect(row, "the owner's words survive").toBeDefined();
    expect(row!.statement).toBe("Prefer small, reversible experiments.");
    expect(row!.unsupported_at, "support is marked withdrawn").not.toBeNull();
    expect(row!.state).toBe("aspirational");
    const links = await t.sql`SELECT signal_id FROM principle_signals WHERE principle_id=${principleId}`;
    expect(links.map((l) => l.signal_id)).not.toContain(signalIds[0]);
  });

  it("removes an unedited machine principle that no longer clears the evidence bar", async () => {
    const owner = await person();
    const { principleId, signalIds } = await principleOnThreeSignals(owner.profileId, false);

    const response = await app(owner).request(`/api/signals/${signalIds[1]}`, { method: "DELETE" });
    expect(response.status).toBe(200);

    expect(await t.sql`SELECT id FROM principles WHERE id=${principleId}`).toHaveLength(0);
  });

  it("does not deadlock against a concurrent principle edit", async () => {
    const owner = await person();
    const { principleId, signalIds } = await principleOnThreeSignals(owner.profileId, true);
    const result = await racePrincipleEdit(owner.profileId, principleId, signalIds[0]!,
      () => deleteProfileSignal(getDb(), { profileId: owner.profileId, signalId: signalIds[0]! }));
    expect(result).toBe(true);
    const [row] = await t.sql`SELECT unsupported_at FROM principles WHERE id=${principleId}`;
    expect(row!.unsupported_at, "the reconcile still ran after the edit").not.toBeNull();
  });
});
