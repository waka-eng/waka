/**
 * EVERYTHING VISIBLE, AND ONLY YOURS — the export gate, on real Postgres.
 *
 * goal: no-quiet-corners, Phase 3 (register item 6). Two claims, both of
 * which only a real database can prove:
 *
 *   1. **Everything.** A fixture account with rows in every exported table
 *      gets every one of them back — the tenancy read applied to egress is
 *      still EVERY row, not a summary. The per-table id sets are compared
 *      exactly.
 *   2. **Only yours.** A second profile's rows in the same tables appear
 *      zero times in the bundle.
 *
 * Plus the door itself: an agent-bound credential is refused outright —
 * leaving with the archive is the person's act, never delegated — and the
 * export writes its own consultation, because the largest serve there is
 * goes on the record like the smallest.
 */
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createExportRoute } from "./export.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  profileId: string;
  session: AuthenticatedSession;
}

async function seedPerson(name: string, type: "human" | "agent" = "human"): Promise<Person> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`export-${seq}-${name}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, ${type}, ${name}) RETURNING id`;
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${String(seq).padStart(64, "9")}, now() + interval '1 day') RETURNING id`;
  return {
    profileId: profile.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: account.id as string, email: `export-${seq}@example.test` },
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

/** Rows in EVERY exported table for one profile; returns ids per table. */
async function seedStack(profileId: string): Promise<Record<string, string[]>> {
  const ids: Record<string, string[]> = {};
  const one = async (label: string, rows: Array<Record<string, unknown>>) => {
    ids[label] = rows.map((r) => r.id as string);
  };

  const [insp] = await t.sql`
    INSERT INTO inspirations (profile_id, text, kind, source)
    VALUES (${profileId}, ${"a kept thing"}, 'note', 'app') RETURNING id`;
  await one("inspirations", [insp]);
  await one(
    "attachments",
    await t.sql`
      INSERT INTO attachments (profile_id, inspiration_id, type, url)
      VALUES (${profileId}, ${insp.id}, 'link', ${"https://example.test/a"}) RETURNING id`,
  );
  await one(
    "reflections",
    await t.sql`
      INSERT INTO reflections (profile_id, inspiration_id, question, answer)
      VALUES (${profileId}, ${insp.id}, ${"why keep it?"}, ${"because it mattered"}) RETURNING id`,
  );

  const [sig] = await t.sql`
    INSERT INTO signals (profile_id, statement, status, confidence)
    VALUES (${profileId}, ${"You keep choosing depth."}, 'emerging', 0) RETURNING id`;
  await one("signals", [sig]);
  await one(
    "signalEvidence",
    await t.sql`
      INSERT INTO signal_evidence (profile_id, signal_id, inspiration_id)
      VALUES (${profileId}, ${sig.id}, ${insp.id}) RETURNING id`,
  );
  await one(
    "signalStatements",
    await t.sql`
      INSERT INTO signal_statements (profile_id, signal_id, statement, reason)
      VALUES (${profileId}, ${sig.id}, ${"You keep choosing depth."}, 'derived') RETURNING id`,
  );
  const [group] = await t.sql`
    INSERT INTO groups (name, join_code, created_by_profile_id)
    VALUES (${"a room"}, ${`code-${profileId.slice(0, 8)}`}, ${profileId}) RETURNING id`;
  await one(
    "signalShares",
    await t.sql`
      INSERT INTO signal_shares (profile_id, signal_id, group_id)
      VALUES (${profileId}, ${sig.id}, ${group.id}) RETURNING id`,
  );

  const [tom] = await t.sql`
    INSERT INTO top_of_minds (profile_id, status, reason)
    VALUES (${profileId}, 'live', 'initial') RETURNING id`;
  await one("topOfMinds", [tom]);
  const [entry] = await t.sql`
    INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
    VALUES (${tom.id}, 'hypothesis', ${"You build rooms you can trust."}, 0) RETURNING id`;
  await one("topOfMindEntries", [entry]);
  await one(
    "topOfMindEntrySignals",
    await t.sql`
      INSERT INTO top_of_mind_entry_signals (entry_id, signal_id, owner_profile_id)
      VALUES (${entry.id}, ${sig.id}, ${profileId}) RETURNING id`,
  );

  const [principle] = await t.sql`
    INSERT INTO principles (profile_id, statement, type, state, origin, rank)
    VALUES (${profileId}, ${"Depth over breadth."}, 'maxim', 'held', 'minted', 1) RETURNING id`;
  await one("principles", [principle]);
  await one(
    "principleSignals",
    await t.sql`
      INSERT INTO principle_signals (profile_id, principle_id, signal_id)
      VALUES (${profileId}, ${principle.id}, ${sig.id}) RETURNING id`,
  );
  await one(
    "principleStatements",
    await t.sql`
      INSERT INTO principle_statements (profile_id, principle_id, statement, reason)
      VALUES (${profileId}, ${principle.id}, ${"Depth over breadth."}, 'minted') RETURNING id`,
  );

  await one(
    "consultations",
    await t.sql`
      INSERT INTO consultations (profile_id, surface) VALUES (${profileId}, 'signals') RETURNING id`,
  );
  await one(
    "suppressions",
    await t.sql`
      INSERT INTO suppressions
        (profile_id, anchor_signal_id, anchor_statement, candidate_statement, similarity)
      VALUES (${profileId}, ${sig.id}, ${"You keep choosing depth."},
              ${"Depth is your habit."}, ${0.9}) RETURNING id`,
  );
  await one(
    "feedback",
    await t.sql`
      INSERT INTO feedback (profile_id, target_type, target_id, value)
      VALUES (${profileId}, 'signal', ${sig.id}, 'true') RETURNING id`,
  );
  const [otherSide] = await t.sql`
    INSERT INTO signals (profile_id, statement, status, confidence)
    VALUES (${profileId}, ${"You avoid depth."}, 'emerging', 0) RETURNING id`;
  ids.signals!.push(otherSide.id as string);
  await one(
    "signalContradictions",
    await t.sql`
      INSERT INTO signal_contradictions (profile_id, a_signal_id, b_signal_id)
      VALUES (${profileId}, LEAST(${sig.id}::uuid, ${otherSide.id}::uuid),
              GREATEST(${sig.id}::uuid, ${otherSide.id}::uuid)) RETURNING id`,
  );
  const [decision] = await t.sql`
    INSERT INTO inspirations (profile_id, text, kind, source)
    VALUES (${profileId}, ${"chose the smaller scope"}, 'decision', 'agent') RETURNING id`;
  ids.inspirations!.push(decision.id as string);
  await one(
    "decisionPrincipleCitations",
    await t.sql`
      INSERT INTO decision_principle_citations (profile_id, inspiration_id, principle_id)
      VALUES (${profileId}, ${decision.id}, ${principle.id}) RETURNING id`,
  );

  return ids;
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
  app.route(
    "/api/export",
    createExportRoute({
      getDatabase: () => t.db as never,
      authMiddleware: authAs as never,
    }),
  );
  return app;
}

afterAll(async () => {
  await t?.cleanup();
});

describe("the export: everything visible, and only yours", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("bundles every row of every layer for the profile, and zero rows of any other", async () => {
    const owner = await seedPerson("Owner");
    const other = await seedPerson("Someone-Else");
    const ownRows = await seedStack(owner.profileId);
    const otherRows = await seedStack(other.profileId);

    const res = await appFor(owner).request("/api/export");
    expect(res.status).toBe(200);
    const { export: bundle } = (await res.json()) as {
      export: Record<string, Array<{ id: string }> | { id: string } | null>;
    };

    expect((bundle.profile as { id: string }).id).toBe(owner.profileId);

    for (const [table, expectedIds] of Object.entries(ownRows)) {
      const served = (bundle[table] as Array<{ id: string }>).map((row) => row.id).sort();
      expect(served, `${table}: every row of the profile, exactly`).toEqual(
        [...expectedIds].sort(),
      );
    }
    for (const [table, foreignIds] of Object.entries(otherRows)) {
      const served = new Set(
        (bundle[table] as Array<{ id: string }>).map((row) => row.id),
      );
      for (const id of foreignIds) {
        expect(served.has(id), `${table}: a row of another profile crossed the egress`).toBe(
          false,
        );
      }
    }
  });

  it("is deterministic — the same stack serves the same bytes twice", async () => {
    const owner = await seedPerson("Owner");
    await seedStack(owner.profileId);

    const first = await appFor(owner).request("/api/export");
    const second = await appFor(owner).request("/api/export");
    /* the export's own consultation rows accrue between calls — the record
       working — so the comparison excludes the consultation list, whose
       content is pinned in the case below */
    const strip = (body: { export: Record<string, unknown> }) => {
      const { consultations: _, ...rest } = body.export;
      return JSON.stringify(rest);
    };
    expect(strip((await first.json()) as never)).toBe(strip((await second.json()) as never));
  });

  it("refuses an agent-bound credential — leaving with the archive is the person's act", async () => {
    const agent = await seedPerson("Courier", "agent");
    const res = await appFor(agent).request("/api/export");
    expect(res.status).toBe(403);
    const [{ n }] = await t.sql`
      SELECT count(*)::int AS n FROM consultations WHERE profile_id = ${agent.profileId}`;
    expect(n, "a refused door writes no serve record").toBe(0);
  });

  it("puts its own serve on the record", async () => {
    const owner = await seedPerson("Owner");
    await appFor(owner).request("/api/export");
    const rows = await t.sql`
      SELECT surface, session_id FROM consultations WHERE profile_id = ${owner.profileId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ surface: "export", session_id: owner.session.sessionId });
  });
});
