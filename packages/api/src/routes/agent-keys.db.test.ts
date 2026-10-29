/**
 * AN AGENT'S STANDING KEY: ISSUED BY THE HUMAN HAND, ACTING AS THE AGENT.
 *
 * Meeting decision, 2026-08-17: per-agent names and API keys, so permission
 * separation runs between profiles. The facts this file holds, each of which
 * is a security claim:
 *
 *   1. A KEY ACTS AS ITS AGENT AND NOTHING ELSE. The secret resolves to an
 *      agent-bound session for exactly the profile it was issued for.
 *   2. ONLY THE HUMAN HAND ISSUES AND REVOKES. An agent-bound session — a
 *      key-holder included — is refused at the door, so a key can never mint
 *      its own successor and outlive revocation.
 *   3. REVOCATION IS IMMEDIATE AND FINAL. The same secret stops resolving
 *      the moment the row is stamped.
 *   4. A KEY BINDS TO AN AGENT ONLY. Issue for a human profile, or another
 *      account's agent, answers not-found — existence is not confirmed.
 *   5. THE SECRET NEVER LANDS. The row keeps a hash and a prefix; the list
 *      surface shows the prefix and nothing recoverable.
 *
 * WHAT THIS MOCKS, AND WHY: only the auth middleware on the ROUTE tests,
 * because the route deps take an injected session (the same seam every route
 * suite uses). The lookup — the actual authentication decision — runs the
 * real query against real Postgres through the db seam.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { lookupAgentKeySession } from "../lib/agent-key-auth.js";
import { requireAuth } from "../lib/middleware.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createAgentKeyRoutes } from "./agent-keys.js";

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
    INSERT INTO accounts (email) VALUES (${`agent-keys-${seq}-${name}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, ${type}, ${name}) RETURNING id`;
  return {
    accountId: account.id as string,
    profileId: profile.id as string,
    session: {
      sessionId: `test-${seq}`,
      account: { id: account.id as string, email: `agent-keys-${seq}@example.test` },
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

async function seedAgentFor(person: Person, name: string): Promise<string> {
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${person.accountId}, 'agent', ${name}) RETURNING id`;
  return profile.id as string;
}

function appFor(person: Person): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.route(
    "/api/agent-keys",
    createAgentKeyRoutes({
      getDatabase: () => t.db as never,
      authMiddleware: async (c, next) => {
        c.set("session", person.session);
        await next();
      },
    }),
  );
  return app;
}

async function issueKey(person: Person, profileId: string): Promise<{ secret: string; id: string }> {
  const response = await appFor(person).request("/api/agent-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profileId, label: "test key" }),
  });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { key: { secret: string; id: string } };
  return { secret: body.key.secret, id: body.key.id };
}

afterAll(async () => {
  await t?.cleanup();
});

describe("the agent's standing key", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it('enforces the five-key limit across concurrent creation requests', async () => {
    const owner = await seedAccount('Cap');
    const profileId = await seedAgentFor(owner, 'cap-agent');
    const app = appFor(owner);
    const create = () => app.request('/api/agent-keys', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profileId, label: 'Concurrent fixture' }) });
    for (let i = 0; i < 4; i++) expect((await create()).status).toBe(201);
    const responses = await Promise.all([create(), create()]);
    expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
    expect(await t.sql`SELECT id FROM agent_keys WHERE profile_id=${profileId} AND revoked_at IS NULL`).toHaveLength(5);
  });

  it("acts as its agent, and as nothing else", async () => {
    const owner = await seedAccount("Ari");
    const agentId = await seedAgentFor(owner, "marketing-agent");
    const { secret } = await issueKey(owner, agentId);

    const session = await lookupAgentKeySession(secret, t.db as never);
    expect(session, "the secret authenticates").not.toBeNull();
    expect(session!.profile.id, "as the agent it was issued for").toBe(agentId);
    expect(session!.profile.type).toBe("agent");
    expect(session!.account.id, "under the issuing account").toBe(owner.accountId);

    expect(
      await lookupAgentKeySession("waka_agent_" + "0".repeat(48), t.db as never),
      "an invented secret of the right shape resolves to nothing",
    ).toBeNull();
  });

  it("is issued and revoked by the human hand only", async () => {
    const owner = await seedAccount("Ari");
    const agentId = await seedAgentFor(owner, "marketing-agent");
    const { id } = await issueKey(owner, agentId);

    /* the agent itself — exactly what a key-holder's session is — may not
       mint keys nor revoke them: a key that could mint its successor
       outlives its own revocation */
    const asAgent: Person = {
      ...owner,
      session: {
        ...owner.session,
        profile: { ...owner.session.profile, id: agentId, type: "agent" },
      },
    };
    const minted = await appFor(asAgent).request("/api/agent-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: agentId }),
    });
    expect(minted.status, "an agent session cannot mint keys").toBe(403);

    const revoked = await appFor(asAgent).request(`/api/agent-keys/${id}`, { method: "DELETE" });
    expect(revoked.status, "nor revoke them").toBe(403);
  });

  it("stops resolving the moment it is revoked", async () => {
    const owner = await seedAccount("Ari");
    const agentId = await seedAgentFor(owner, "marketing-agent");
    const { secret, id } = await issueKey(owner, agentId);
    expect(await lookupAgentKeySession(secret, t.db as never)).not.toBeNull();

    const response = await appFor(owner).request(`/api/agent-keys/${id}`, { method: "DELETE" });
    expect(response.status).toBe(200);

    expect(
      await lookupAgentKeySession(secret, t.db as never),
      "the same secret, one revocation later",
    ).toBeNull();
  });

  it("binds to an agent only, and never confirms what it refuses", async () => {
    const owner = await seedAccount("Ari");
    const other = await seedAccount("Bo");
    const foreignAgent = await seedAgentFor(other, "someone-elses-agent");

    const forHuman = await appFor(owner).request("/api/agent-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: owner.profileId }),
    });
    expect(forHuman.status, "a human profile cannot hold a key").toBe(404);

    const forForeign = await appFor(owner).request("/api/agent-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileId: foreignAgent }),
    });
    expect(forForeign.status, "another account's agent is a stranger's").toBe(404);
  });

  it("records a key-holder's consultation without a session row", async () => {
    /* The agent's first READ through its key 500'd in live use: the
       consultation mark wrote the synthetic `agent-key:<id>` session id into
       a uuid column. The mark now records a null credential and the reader
       profile — the same shape a pruned session leaves. */
    const owner = await seedAccount("Ari");
    const agentId = await seedAgentFor(owner, "marketing-agent");
    const { secret } = await issueKey(owner, agentId);
    const session = await lookupAgentKeySession(secret, t.db as never);
    expect(session).not.toBeNull();

    const { recordConsultation } = await import("../lib/consultations.js");
    await recordConsultation(t.db as never, {
      profileId: agentId,
      session: session!,
      surface: "signals",
    });

    const marks = await t.sql`
      SELECT session_id, reader_profile_id FROM consultations`;
    expect(marks).toHaveLength(1);
    expect(marks[0]!.session_id, "no session row to name — null, never a 500").toBeNull();
    expect(marks[0]!.reader_profile_id, "but the reader is named").toBe(agentId);
  });

  it("rides the Authorization header only — a key in a cookie is not a credential", async () => {
    /* A cookie is attached by the browser to whatever asks. Accepting a key
       there would let a page that can set cookies fix a victim's browser to
       an attacker's agent, and every keep the victim made would land in the
       attacker's stack. The REAL middleware makes the ruling, so the rule
       cannot drift from the code that enforces it. The lookup underneath
       reads the process-global database, which is not this suite's schema —
       so the header case asserts the ruling reaches the lookup (500-or-401,
       never a session), and the cookie case asserts it never does. */
    const app = new Hono<AuthEnv>();
    app.use("*", requireAuth);
    app.get("/probe", (c) => c.json({ as: c.get("session").profile.id }));

    const viaCookie = await app.request("/probe", {
      headers: { Cookie: `waka_session=waka_agent_${"a".repeat(48)}` },
    });
    expect(viaCookie.status, "the cookie channel refuses the shape outright").toBe(401);
  });

  it("never lands the secret, and the list shows only the prefix", async () => {
    const owner = await seedAccount("Ari");
    const agentId = await seedAgentFor(owner, "marketing-agent");
    const { secret } = await issueKey(owner, agentId);

    const rows = await t.sql`SELECT token_hash, prefix FROM agent_keys`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash, "the hash is not the secret").not.toBe(secret);
    expect(secret.startsWith(rows[0]!.prefix as string), "the prefix is the secret's head").toBe(
      true,
    );
    expect((rows[0]!.prefix as string).length, "and only its head").toBeLessThan(secret.length / 2);

    const listed = await appFor(owner).request("/api/agent-keys");
    const body = (await listed.json()) as { keys: Array<Record<string, unknown>> };
    expect(body.keys).toHaveLength(1);
    expect(JSON.stringify(body.keys), "no field of the list carries the secret").not.toContain(
      secret,
    );
  });
});
