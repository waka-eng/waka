/** The nightly handler schedules the weekly garden pass — real SQL, scripted model. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../test/helpers/index.js";
import { getDb } from "./lib/db.js";
import { setDefaultModelProviderForTests, type ModelProvider } from "./lib/model-provider.js";
import { handler } from "./principle-refresh.js";

let t: TestDatabase;
let sequence = 0;

async function personWith(statuses: Array<"active" | "emerging">) {
  const [a] = await t.sql`INSERT INTO accounts(email) VALUES (${`nightly-garden-${sequence++}@example.test`}) RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${a.id},'human','Test') RETURNING id`;
  for (const [n, status] of statuses.entries()) {
    const [s] = await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${p.id},${`Pattern ${n}`}) RETURNING id`;
    if (status !== "active") continue;
    for (let i = 0; i < 3; i++) {
      const [ins] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${p.id},'raw') RETURNING id`;
      await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
        VALUES (${p.id},${p.id},${s.id},${ins.id})`;
    }
    await t.sql`UPDATE signals SET status='active' WHERE id=${s.id}`;
  }
  return p.id as string;
}

const gardenJobs = (profileId: string) =>
  t.sql`SELECT id FROM background_jobs WHERE profile_id=${profileId} AND type='tend_signal_garden'`;

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
  process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = "0";
  /* The garden has no vectors to judge. A valid Principle run may abstain. */
  setDefaultModelProviderForTests({ async distillPrinciples() { return { candidates: [] }; } } as unknown as ModelProvider);
});
afterAll(async () => {
  setDefaultModelProviderForTests(null);
  await getDb().$client.end();
  await t?.cleanup();
});

describe("the nightly handler and the signal garden", () => {
  it("tends a standing set of emerging signals — the split duplicates the gardener exists for", async () => {
    const profileId = await personWith(["emerging", "emerging", "emerging"]);
    await handler();
    expect(await gardenJobs(profileId)).toHaveLength(1);
  });

  it("tends one active signal beside an emerging one", async () => {
    const profileId = await personWith(["active", "emerging"]);
    await handler();
    expect(await gardenJobs(profileId)).toHaveLength(1);
  });

  it("reaches existing first-Principle evidence once without another save or reading", async () => {
    const first = await personWith(["emerging", "emerging"]);
    const previouslyServed = await personWith(["emerging", "emerging"]);
    await t.sql`INSERT INTO principles(profile_id,statement,origin,rank) VALUES (${previouslyServed},'Prior choice','declared',1)`;
    await t.sql`DELETE FROM principles WHERE profile_id=${previouslyServed}`;

    for (const profileId of [first, previouslyServed]) {
      const rows = await t.sql`SELECT id FROM signals WHERE profile_id=${profileId} ORDER BY statement`;
      for (const [i, row] of rows.entries()) {
        const [saved] = await t.sql`INSERT INTO inspirations(profile_id,text)
          VALUES (${profileId},${i === 0 ? 'I trialed the supplier before ordering stock.' : 'I tested the workshop with one team before expansion.'}) RETURNING id`;
        await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
          VALUES (${profileId},${profileId},${row.id},${saved.id})`;
      }
    }
    await handler();
    await handler();
    const jobs = await t.sql`SELECT profile_id, status FROM background_jobs
      WHERE type='refresh_principles' AND profile_id IN (${first},${previouslyServed})`;
    expect([...jobs]).toEqual([{ profile_id: first, status: 'succeeded' }]);
  });

  it("still leaves a profile with a single standing signal alone", async () => {
    const profileId = await personWith(["emerging"]);
    await handler();
    expect(await gardenJobs(profileId)).toHaveLength(0);
  });
});
