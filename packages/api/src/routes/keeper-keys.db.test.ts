/**
 * THE KEEPER'S STANDING KEY: THE PERSON'S OWN HAND, SCOPED DOWN.
 *
 * Founder ask, 2026-08-29, completing that day's ruling: agents no longer
 * capture into the human profile, so the person gets a first-class key for
 * their own MCP. The facts this file holds, each a security claim:
 *
 *   1. A KEY ACTS AS ITS PERSON, SCOPED. The secret resolves to the human
 *      profile it was issued for, and the session carries `keyScoped` — the
 *      mark the chokepoint and the matrix both answer.
 *   2. KEEP AND RECALL, NOTHING ELSE. The allowlist admits capturing an
 *      inspiration and reading the four layers; every other verb — curation,
 *      other profiles, account decisions — is refused at the door.
 *   3. ONLY THE UNSCOPED HUMAN SESSION ISSUES AND REVOKES. An agent session
 *      is refused, and so is a keeper-key session itself — a key that could
 *      mint its successor would outlive its own revocation.
 *   4. REVOCATION IS IMMEDIATE AND FINAL.
 *   5. A KEY BINDS TO A HUMAN ONLY, RE-CHECKED AT LOOKUP. A hand-forged row
 *      pointing at an agent profile resolves to nothing.
 *   6. THE SECRET NEVER LANDS. Hash and prefix in the row; the list shows
 *      the prefix and nothing recoverable.
 *
 * WHAT THIS MOCKS, AND WHY: only the auth middleware on the ROUTE tests
 * (the same injected-session seam every route suite uses). The lookup — the
 * authentication decision — runs the real query against real Postgres. The
 * allowlist is tested as the exported pure function; that it is consulted at
 * all is `requireAuth`'s five lines, proven end-to-end by the live probe
 * that caught both of this feature's launch bugs.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { lookupKeeperKeySession } from "../lib/keeper-key-auth.js";
import { keeperKeyMayPass, requireAuth } from "../lib/middleware.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createKeeperKeyRoutes } from "./keeper-keys.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  accountId: string;
  profileId: string;
  session: AuthenticatedSession;
}

async function seedAccount(name: string, type: "human" | "agent" = "human"): Promise<Person> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`keeper-keys-${seq}-${name}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, ${type}, ${name}) RETURNING id`;
  return {
    accountId: account.id as string,
    profileId: profile.id as string,
    session: {
      sessionId: `test-${seq}`,
      account: { id: account.id as string, email: `keeper-keys-${seq}@example.test` },
      profile: {
        id: profile.id as string,
        accountId: account.id as string,
        type,
        name,
        preferredLocale: "en-US",
      },
    },
  };
}

function appFor(person: Person): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.route(
    "/api/keeper-keys",
    createKeeperKeyRoutes({
      getDatabase: () => t.db as never,
      authMiddleware: async (c, next) => {
        c.set("session", person.session);
        await next();
      },
    }),
  );
  return app;
}

async function issueKey(person: Person): Promise<{ secret: string; id: string }> {
  const response = await appFor(person).request("/api/keeper-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ label: "test key" }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { key: { secret: string; id: string } };
  return { secret: body.key.secret, id: body.key.id };
}

afterAll(async () => {
  await t?.cleanup();
});

describe("the keeper's standing key", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("acts as its person, and the session it resolves is scoped", async () => {
    const owner = await seedAccount("Ari");
    const { secret } = await issueKey(owner);

    const session = await lookupKeeperKeySession(secret, t.db as never);
    expect(session, "the secret authenticates").not.toBeNull();
    expect(session!.profile.id, "as the person it was issued for").toBe(owner.profileId);
    expect(session!.profile.type).toBe("human");
    expect(session!.keyScoped, "carrying the scope mark the matrix answers").toBe(true);

    expect(
      await lookupKeeperKeySession("waka_keeper_" + "0".repeat(48), t.db as never),
      "an invented secret of the right shape resolves to nothing",
    ).toBeNull();
  });

  it("is issued and revoked by the unscoped human session only", async () => {
    const owner = await seedAccount("Ari");
    const { id } = await issueKey(owner);

    const asAgent = await seedAccount("Scout", "agent");
    const mintedByAgent = await appFor(asAgent).request("/api/keeper-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(mintedByAgent.status, "an agent session cannot mint the person's key").toBe(403);

    /* the keeper-key session itself — same human profile, but scoped — may
       not mint nor revoke: a key that could mint its successor outlives
       revocation */
    const asKey: Person = {
      ...owner,
      session: { ...owner.session, keyScoped: true },
    };
    const mintedByKey = await appFor(asKey).request("/api/keeper-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(mintedByKey.status, "a keeper key cannot mint its successor").toBe(403);
    const revokedByKey = await appFor(asKey).request(`/api/keeper-keys/${id}`, {
      method: "DELETE",
    });
    expect(revokedByKey.status, "nor revoke").toBe(403);
  });

  it("stops resolving the moment it is revoked", async () => {
    const owner = await seedAccount("Ari");
    const { secret, id } = await issueKey(owner);
    expect(await lookupKeeperKeySession(secret, t.db as never)).not.toBeNull();

    const response = await appFor(owner).request(`/api/keeper-keys/${id}`, { method: "DELETE" });
    expect(response.status).toBe(200);

    expect(
      await lookupKeeperKeySession(secret, t.db as never),
      "the same secret, one revocation later",
    ).toBeNull();
  });

  it("binds to a human only — a forged row for an agent resolves to nothing", async () => {
    /* No profileId rides the issue body, so the route cannot be talked into
       an agent binding; the deeper claim is that even a hand-written row
       cannot. The lookup re-checks `profiles.type = 'human'` in the query. */
    const owner = await seedAccount("Ari");
    const { secret } = await issueKey(owner);
    const [agent] = await t.sql`
      INSERT INTO profiles (account_id, type, name)
      VALUES (${owner.accountId}, 'agent', 'forged-target') RETURNING id`;
    await t.sql`UPDATE keeper_keys SET profile_id = ${agent.id as string}`;

    expect(
      await lookupKeeperKeySession(secret, t.db as never),
      "re-pointed at an agent, the key is no credential at all",
    ).toBeNull();
  });

  it("records a key-holder's consultation without a session row", async () => {
    /* The keeper's first READ through its key 500'd in live use — the same
       launch bug the agent key had, because the consultation mark's fix
       named that key's prefix instead of the shape. The mark now records a
       null credential for ANY synthetic key-borne session id. */
    const owner = await seedAccount("Ari");
    const { secret } = await issueKey(owner);
    const session = await lookupKeeperKeySession(secret, t.db as never);
    expect(session).not.toBeNull();

    const { recordConsultation } = await import("../lib/consultations.js");
    await recordConsultation(t.db as never, {
      profileId: owner.profileId,
      session: session!,
      surface: "signals",
    });

    const marks = await t.sql`
      SELECT session_id, reader_profile_id FROM consultations`;
    expect(marks).toHaveLength(1);
    expect(marks[0]!.session_id, "no session row to name — null, never a 500").toBeNull();
    expect(marks[0]!.reader_profile_id, "but the reader is named").toBe(owner.profileId);
  });

  it("admits keep and recall, and nothing else", async () => {
    const passes: Array<[string, string]> = [
      ["POST", "/api/inspirations"],
      ["GET", "/api/inspirations"],
      ["GET", "/api/inspirations/00000000-0000-0000-0000-000000000000"],
      ["GET", "/api/inspirations/00000000-0000-0000-0000-000000000000/processing"],
      ["GET", "/api/signals"],
      ["GET", "/api/recall"],
      ["GET", "/api/top-of-mind"],
      ["GET", "/api/principles"],
      ["GET", "/api/principles.md"],
      ["GET", "/api/weather"],
      ["GET", "/api/experiences"],
      ["GET", "/api/graph"],
      /* The basket (2026-10-15): the key proposes; it never decides. */
      ["POST", "/api/harvest"],
    ];
    for (const [method, path] of passes) {
      expect(keeperKeyMayPass(method, path), `${method} ${path} is the key's work`).toBe(true);
    }

    const refused: Array<[string, string]> = [
      ["PATCH", "/api/inspirations/00000000-0000-0000-0000-000000000000"],
      ["DELETE", "/api/inspirations/00000000-0000-0000-0000-000000000000"],
      ["POST", "/api/inspirations/00000000-0000-0000-0000-000000000000/reflections"],
      ["POST", "/api/inspirations/00000000-0000-0000-0000-000000000000/processing/retry"],
      ["POST", "/api/feedback"],
      ["GET", "/api/profiles"],
      ["POST", "/api/profiles"],
      ["GET", "/api/export"],
      ["GET", "/api/sessions"],
      ["GET", "/api/consultations"],
      ["GET", "/api/agent-keys"],
      ["POST", "/api/agent-keys"],
      ["GET", "/api/keeper-keys"],
      ["POST", "/api/keeper-keys"],
      ["GET", "/api/groups"],
      ["DELETE", "/api/auth/me"],
      ["POST", "/api/inspirationsevil"],
      ["GET", "/api/inspirationsevil"],
      /* Reading the basket and deciding on it are the person's, at a browser. */
      ["GET", "/api/harvest"],
      ["POST", "/api/harvest/00000000-0000-0000-0000-000000000000/keep"],
      ["POST", "/api/harvest/00000000-0000-0000-0000-000000000000/decline"],
      ["POST", "/api/harvestevil"],
    ];
    for (const [method, path] of refused) {
      expect(keeperKeyMayPass(method, path), `${method} ${path} is beyond the key`).toBe(false);
    }
  });

  it("rides the Authorization header only — a key in a cookie is not a credential", async () => {
    /* A cookie is attached by the browser to whatever asks; accepting a key
       there would let a page that sets cookies fix a victim's browser to a
       stranger's memory. The REAL middleware makes the ruling. */
    const app = new Hono<AuthEnv>();
    app.use("*", requireAuth);
    app.get("/probe", (c) => c.json({ as: c.get("session").profile.id }));

    const viaCookie = await app.request("/probe", {
      headers: { Cookie: `waka_session=waka_keeper_${"a".repeat(48)}` },
    });
    expect(viaCookie.status, "the cookie channel refuses the shape outright").toBe(401);
  });

  it("never lands the secret, and the list shows only the prefix", async () => {
    const owner = await seedAccount("Ari");
    const { secret } = await issueKey(owner);

    const rows = await t.sql`SELECT token_hash, prefix FROM keeper_keys`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash, "the hash is not the secret").not.toBe(secret);
    expect(secret.startsWith(rows[0]!.prefix as string), "the prefix is the secret's head").toBe(
      true,
    );
    expect((rows[0]!.prefix as string).length, "and only its head").toBeLessThan(secret.length / 2);

    const listed = await appFor(owner).request("/api/keeper-keys");
    const body = (await listed.json()) as { keys: Array<Record<string, unknown>> };
    expect(body.keys).toHaveLength(1);
    expect(JSON.stringify(body.keys), "no field of the list carries the secret").not.toContain(
      secret,
    );
  });
});
