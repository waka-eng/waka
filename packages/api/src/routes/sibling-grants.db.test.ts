/**
 * THE SIBLING DOOR HAS A HAND ON IT — the flip, live on real Postgres.
 *
 * goal: no-quiet-corners, Phase 6 (register item 5). The open default —
 * any agent session reading any profile in the account — is retired. This
 * suite drives the REAL routes with real sessions:
 *
 *   - a granted sibling reads; an ungranted one is refused (the flip);
 *   - revocation takes effect on the next request;
 *   - the human's own profile and the agent's bound profile need no grant;
 *   - the human session is the account's admin, grant or no grant;
 *   - only the human hand can open or close the door.
 *
 * The pure matrix cells live in `profile-access.test.ts`; this file is the
 * live half the gate names.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createAgentGrantRoutes } from "./agent-grants.js";
import { createSignalRoutes } from "./signals.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  profileId: string;
  session: AuthenticatedSession;
}

async function seedProfileWithSession(
  accountId: string,
  name: string,
  type: "human" | "agent",
): Promise<Person> {
  seq += 1;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${accountId}, ${type}, ${name}) RETURNING id`;
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${String(seq).padStart(64, "7")}, now() + interval '1 day') RETURNING id`;
  return {
    profileId: profile.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: accountId, email: `grants-${seq}@example.test` },
      profile: {
        id: profile.id as string,
        accountId,
        type,
        name,
        preferredLocale: "en-US",
      },
    },
  };
}

async function seedHousehold() {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`grants-${seq}@example.test`}) RETURNING id`;
  const accountId = account.id as string;
  const human = await seedProfileWithSession(accountId, "Owner", "human");
  const scout = await seedProfileWithSession(accountId, "Scout", "agent");
  const courier = await seedProfileWithSession(accountId, "Courier", "agent");
  return { human, scout, courier };
}

function appFor(person: Person): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  const authAs = async (
    c: { set: (k: "session", v: AuthenticatedSession) => void },
    next: () => Promise<void>,
  ) => {
    c.set("session", person.session);
    await next();
  };
  const deps = { getDatabase: () => t.db as never, authMiddleware: authAs as never };
  app.route("/api/signals", createSignalRoutes(deps));
  app.route("/api/agent-grants", createAgentGrantRoutes(deps));
  return app;
}

const readSignalsOf = (reader: Person, target: Person) =>
  appFor(reader).request(`/api/signals?profile=${target.profileId}`);

afterAll(async () => {
  await t?.cleanup();
});

describe("the sibling door: granted reads, refused without, revoked on the next request", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("refuses an ungranted sibling read — the open default is retired", async () => {
    const { scout, courier } = await seedHousehold();
    const res = await readSignalsOf(scout, courier);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Not permitted");
  });

  it("needs no grant for the paths the product is made of", async () => {
    const { human, scout, courier } = await seedHousehold();
    // The agent reading its human: the conditioning case.
    expect((await readSignalsOf(scout, human)).status).toBe(403);
    // The agent reading itself.
    expect((await readSignalsOf(scout, scout)).status).toBe(200);
    // The human reading any of its agents: the account's admin.
    expect((await readSignalsOf(human, scout)).status).toBe(200);
    expect((await readSignalsOf(human, courier)).status).toBe(200);
  });

  it("historical grants remain manageable but never open another profile", async () => {
    const { human, scout, courier } = await seedHousehold();

    const [grant] = await t.sql`INSERT INTO agent_read_grants(grantee_profile_id,target_profile_id,granted_by_profile_id)
      VALUES(${scout.profileId},${courier.profileId},${human.profileId}) RETURNING id`;

    expect((await readSignalsOf(scout, courier)).status).toBe(403);
    // Undirected it is not: the grant opens one direction only.
    expect((await readSignalsOf(courier, scout)).status).toBe(403);

    const revoked = await appFor(human).request(`/api/agent-grants/${grant.id}`, {
      method: "DELETE",
    });
    expect(revoked.status).toBe(200);

    expect(
      (await readSignalsOf(scout, courier)).status,
      "revocation takes effect on the very next request",
    ).toBe(403);

    // The record survives the revocation — a closed door is still history.
    const listed = await appFor(human).request("/api/agent-grants");
    const { grants } = (await listed.json()) as {
      grants: Array<{ id: string; revokedAt: string | null }>;
    };
    expect(grants).toHaveLength(1);
    expect(grants[0]!.revokedAt).not.toBeNull();
  });

  it("only the human hand opens or closes the door", async () => {
    const { scout, courier } = await seedHousehold();
    const res = await appFor(scout).request("/api/agent-grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        granteeProfileId: scout.profileId,
        targetProfileId: courier.profileId,
      }),
    });
    expect(res.status).toBe(403);
  });

  it("new cross-profile grants cannot be created", async () => {
    const { human, scout } = await seedHousehold();
    const other = await seedHousehold();

    const toHuman = await appFor(human).request("/api/agent-grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        granteeProfileId: scout.profileId,
        targetProfileId: human.profileId,
      }),
    });
    expect(toHuman.status, "new read grants are retired").toBe(410);

    const foreign = await appFor(human).request("/api/agent-grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        granteeProfileId: scout.profileId,
        targetProfileId: other.courier.profileId,
      }),
    });
    expect(foreign.status, "retired grants expose no profile access").toBe(410);
  });
});
