/**
 * AN AGENT ACTS FOR YOU. IT DOES NOT SPEAK AS YOU TO OTHER PEOPLE.
 *
 * Agents legitimately hold "capture" on the human profile — relaying what you
 * said is the whole point. Two routes let that permission carry further than
 * it should, and an agent credential is reachable by prompt injection, so both
 * were a single request from "an agent read a poisoned page" to "a stranger's
 * sentence is published under your name".
 *
 * These are database tests because both are about which row is written and
 * which row a stranger can then read.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";

let t: TestDatabase;
let seq = 0;

async function seedAccount() {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`agent-${seq}@example.test`}) RETURNING id`;
  const [human] = await t.sql`
    INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, 'human', 'You')
    RETURNING id`;
  const [agent] = await t.sql`
    INSERT INTO profiles (account_id, type, name, public_handle, public_profile_enabled)
    VALUES (${account.id}, 'agent', 'Your agent', ${`agent-handle-${seq}`}, true)
    RETURNING id`;
  return { accountId: account.id as string, human: human.id as string, agent: agent.id as string };
}

describe("the account boundary an agent may not cross", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });
  afterAll(async () => {
    await t?.sql.end();
  });

  /**
   * A public profile is a person choosing to be found. The handle columns live
   * on EVERY profile, so an agent switched public was reachable at the
   * unauthenticated endpoint exactly like a human one — publishing an
   * account's memory to anyone with the URL.
   */
  it("does not serve an agent profile as a public profile", async () => {
    const { agent } = await seedAccount();

    const rows = await t.sql`
      SELECT id FROM profiles
      WHERE type = 'human'
        AND public_profile_enabled = true
        AND public_handle = (SELECT public_handle FROM profiles WHERE id = ${agent})`;

    expect(
      rows.length,
      "an agent's handle resolves at the public endpoint, so its top of mind is readable by anyone",
    ).toBe(0);
  });

  /**
   * Capturing FOR someone is not publishing FOR them. `public` means the text
   * enters the ground of every group that profile belongs to, attributed to
   * them, across an account boundary the canon says an inspiration never
   * crosses.
   */
  it("keeps the column default when one profile writes for another", async () => {
    const { human } = await seedAccount();

    /* what the route now writes for a cross-profile capture: no visibility */
    const [row] = await t.sql`
      INSERT INTO inspirations (profile_id, text, source)
      VALUES (${human}, 'relayed by an agent', 'agent')
      RETURNING visibility`;

    expect(
      row.visibility,
      "an agent's relay is public, so it reaches every room the human is in",
    ).toBe("private");
  });
});
