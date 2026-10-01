import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/index.js";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createGroupForProfile } from "../routes/groups-membership.js";
import { reviewSignalSupport } from "./signal-support-review.js";
import type { SignalSupportAssessmentInput } from "./model-provider.js";

let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

async function fixture(group = false) {
  const [account] = await t.sql`INSERT INTO accounts (email) VALUES (${`support-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [inspiration] = await t.sql`INSERT INTO inspirations (profile_id, text, visibility)
    VALUES (${profile.id}, 'I enjoy a quiet morning', 'public') RETURNING id`;
  const [reflection] = await t.sql`INSERT INTO reflections (profile_id, inspiration_id, question, answer)
    VALUES (${profile.id}, ${inspiration.id}, 'Why?', 'PRIVATE_SENTINEL I need quiet before decisions') RETURNING id`;
  let destination = profile.id;
  let groupId: string | undefined;
  if (group) {
    const created = await createGroupForProfile(t.db as never, { profileId: profile.id as string, name: "Shared room" });
    groupId = created.id;
    const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id = ${created.id}`;
    destination = mind.id;
  }
  const [signal] = await t.sql`INSERT INTO signals (profile_id, statement, input_policy, locked_at)
    VALUES (${destination}, 'I choose quiet before making decisions', ${group ? "group-public-v1" : null}, now()) RETURNING id`;
  await t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
    VALUES (${destination}, ${profile.id}, ${signal.id}, ${inspiration.id})`;
  return { ownerProfileId: profile.id as string, inspirationId: inspiration.id as string,
    reflectionId: reflection.id as string, signalId: signal.id as string,
    deriveIntoProfileId: group ? destination as string : undefined, groupId };
}
function provider(verdict: "supported" | "unsupported" | "unresolved") {
  return { assessSignalSupport: vi.fn(async (input: SignalSupportAssessmentInput) => ({
    assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict,
      sourceIds: verdict === "supported" ? [input.sources[0]!.id] : [] })),
  })) };
}

describe("read-only evidence support assessment", () => {
  it("runs on a connection where Postgres itself refuses writes", async () => {
    const f = await fixture();
    const readOnly = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false,
      connection: { default_transaction_read_only: true, search_path: t.schemaName } });
    try {
      const report = await reviewSignalSupport(drizzle(readOnly, { schema }), { ...f, provider: provider("supported"), maxCalls: 1 });
      expect(report.items[0]?.verdict).toBe("supported");
      await expect(readOnly`UPDATE signals SET statement = 'unwanted change' WHERE id = ${f.signalId}`).rejects.toThrow(/read-only/);
    } finally { await readOnly.end(); }
  });

  it("assesses an existing link explicitly, without withdrawing it or rewriting locked words", async () => {
    const f = await fixture();
    const model = provider("unsupported");
    const before = await t.sql`SELECT row_to_json(s) AS signal, row_to_json(e) AS evidence FROM signals s
      JOIN signal_evidence e ON e.signal_id = s.id WHERE s.id = ${f.signalId}`;
    const report = await reviewSignalSupport(t.db as never, { ...f, provider: model, maxCalls: 1 });
    expect(report.status).toBe("current");
    expect(report.items[0]).toMatchObject({ signalId: f.signalId, verdict: "unsupported" });
    expect(model.assessSignalSupport.mock.calls[0]?.[0].claims).toEqual([
      { signalId: f.signalId, statement: "I choose quiet before making decisions" },
    ]);
    expect(await t.sql`SELECT row_to_json(s) AS signal, row_to_json(e) AS evidence FROM signals s
      JOIN signal_evidence e ON e.signal_id = s.id WHERE s.id = ${f.signalId}`).toEqual(before);
    expect(JSON.stringify(report)).not.toContain("PRIVATE_SENTINEL");
    expect(JSON.stringify(report)).not.toContain("I choose quiet");
  });

  it("assesses only remaining material after deletion, and can reconsider a mistaken negative review", async () => {
    const f = await fixture();
    await t.sql`DELETE FROM reflections WHERE id = ${f.reflectionId}`;
    const negative = provider("unsupported");
    const first = await reviewSignalSupport(t.db as never, { ...f, provider: negative, maxCalls: 1 });
    expect(JSON.stringify(negative.assessSignalSupport.mock.calls)).not.toContain("PRIVATE_SENTINEL");
    expect(first.items[0]?.verdict).toBe("unsupported");
    const corrected = await reviewSignalSupport(t.db as never, { ...f, provider: provider("supported"), maxCalls: 1 });
    expect(corrected.items[0]?.verdict).toBe("supported");
    expect(corrected.material.hash).toBe(first.material.hash);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(1);
  });

  it.each(["source", "statement"])("invalidates a review when its %s changes during the call", async (changed) => {
    const f = await fixture();
    const model = provider("unsupported");
    const original = model.assessSignalSupport.getMockImplementation()!;
    model.assessSignalSupport.mockImplementation(async (input) => {
      if (changed === "source") await t.sql`DELETE FROM reflections WHERE id = ${f.reflectionId}`;
      else await t.sql`UPDATE signals SET statement = 'My newer words', locked_at = now() WHERE id = ${f.signalId}`;
      return original(input);
    });
    const report = await reviewSignalSupport(t.db as never, { ...f, provider: model, maxCalls: 1 });
    expect(report.status).toBe("stale");
    expect(report.items[0]).toMatchObject({ verdict: "unresolved", issue: "inputs_changed" });
  });

  it("keeps private answers and legacy room wording out of a public review", async () => {
    const f = await fixture(true);
    const [legacy] = await t.sql`INSERT INTO signals (profile_id, statement)
      VALUES (${f.deriveIntoProfileId!}, 'LEGACY_PRIVATE_SENTINEL') RETURNING id`;
    await t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${f.deriveIntoProfileId!}, ${f.ownerProfileId}, ${legacy.id}, ${f.inspirationId})`;
    const model = provider("supported");
    const report = await reviewSignalSupport(t.db as never, { ...f, provider: model, maxCalls: 1 });
    expect(report.status).toBe("current");
    expect(report.restrictedClaimCount).toBe(1);
    expect(report.items).toHaveLength(1);
    expect(JSON.stringify(model.assessSignalSupport.mock.calls)).not.toContain("PRIVATE_SENTINEL");
    expect(JSON.stringify(report)).not.toContain("PRIVATE_SENTINEL");
    const before = report.material.hash;
    await t.sql`UPDATE reflections SET answer = 'PRIVATE_SENTINEL a different private answer' WHERE id = ${f.reflectionId}`;
    const next = await reviewSignalSupport(t.db as never, { ...f, provider: model, maxCalls: 1 });
    expect(next.material.hash).toBe(before);
    expect(model.assessSignalSupport.mock.calls[1]).toEqual(model.assessSignalSupport.mock.calls[0]);
  });

  it("invalidates a room review if the member leaves during the call", async () => {
    const f = await fixture(true);
    const model = provider("unsupported");
    const original = model.assessSignalSupport.getMockImplementation()!;
    model.assessSignalSupport.mockImplementation(async (input) => {
      await t.sql`DELETE FROM group_members WHERE group_id = ${f.groupId!} AND profile_id = ${f.ownerProfileId}`;
      return original(input);
    });
    const report = await reviewSignalSupport(t.db as never, { ...f, provider: model, maxCalls: 1 });
    expect(report.status).toBe("stale");
    expect(report.items[0]?.verdict).toBe("unresolved");
    await expect(reviewSignalSupport(t.db as never, { ...f, provider: model, maxCalls: 1 })).rejects.toThrow(/not_authorized/);
    expect(model.assessSignalSupport).toHaveBeenCalledTimes(1);
  });

  it("an unavailable attachment cannot be used as evidence of absence", async () => {
    const f = await fixture();
    await t.sql`INSERT INTO attachments (profile_id, inspiration_id, type, url, enrichment_status)
      VALUES (${f.ownerProfileId}, ${f.inspirationId}, 'link', 'https://example.test', 'failed')`;
    const report = await reviewSignalSupport(t.db as never, { ...f, provider: provider("unsupported"), maxCalls: 1 });
    expect(report.items[0]).toMatchObject({ verdict: "unresolved", issue: "incomplete_material" });
  });

  it("a wrong source owner cannot make a model call", async () => {
    const f = await fixture();
    const model = provider("supported");
    await expect(reviewSignalSupport(t.db as never, { ...f,
      ownerProfileId: "00000000-0000-4000-8000-000000000001", provider: model, maxCalls: 1 })).rejects.toThrow(/missing_inspiration/);
    expect(model.assessSignalSupport).not.toHaveBeenCalled();
  });
});
