import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { deriveSignalsForInspiration } from "./signal-derivation.js";
import type { ModelProvider } from "./model-provider.js";
import { ensureInspirationEmbedding } from "./inspiration-embeddings.js";
import { getProfileSignal } from "../routes/signals.js";
import { createGroupForProfile } from "../routes/groups-membership.js";

let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts (email) VALUES (${`material-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [inspiration] = await t.sql`INSERT INTO inspirations (profile_id, text) VALUES (${profile.id}, 'A walk by the water') RETURNING id`;
  const [reflection] = await t.sql`INSERT INTO reflections (profile_id, inspiration_id, question, answer)
    VALUES (${profile.id}, ${inspiration.id}, 'Why?', 'PRIVATE_SENTINEL I need quiet before deciding') RETURNING id`;
  return { profileId: profile.id as string, inspirationId: inspiration.id as string, reflectionId: reflection.id as string };
}
function stubs(quote: string) {
  return {
    modelProvider: { extractSignalCandidates: async () => ({ statements: [{
      statement: "Quiet helps before a decision.", quote, reason: `Grounded in ${quote}`,
    }] }), judgeSignalMatch: async () => ({ relation: "same" }) } as unknown as ModelProvider,
    embeddingClient: { model: "material-test", embed: async (_text: string) => [1, ...new Array<number>(767).fill(0)] },
  };
}

describe("evidence uses the material that was actually read", () => {
  it("records the exact reflected source and hashes, without storing another answer copy", async () => {
    const f = await fixture();
    const result = await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, {
      db: t.db as never, ...stubs("PRIVATE_SENTINEL I need quiet before deciding"),
    });
    const [row] = await t.sql`SELECT * FROM signal_evidence WHERE inspiration_id = ${f.inspirationId}`;
    expect(row.quote_reflection_id).toBe(f.reflectionId);
    expect(row.quote_source_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.material).toMatchObject({ scope: "personal", policy: "inspiration-material-v1" });
    expect(row.material.sources.map((item: { id: string }) => item.id)).toContain(f.reflectionId);
    expect(JSON.stringify(row.material)).not.toContain("PRIVATE_SENTINEL");
    const view = await getProfileSignal(t.db as never, { profileId: f.profileId, signalId: result.mintedSignalIds[0]! });
    expect(view?.evidence[0]?.quoteReflectionId).toBe(f.reflectionId);
  });

  it("refuses a quote assembled across the inspiration and a reflection", async () => {
    const f = await fixture();
    await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, {
      db: t.db as never, ...stubs("water PRIVATE_SENTINEL"),
    });
    const [row] = await t.sql`SELECT quote, quote_reflection_id FROM signal_evidence WHERE inspiration_id = ${f.inspirationId}`;
    expect(row).toMatchObject({ quote: null, quote_reflection_id: null });
  });
  it("removes a deleted answer's copied quote, reason and generated follow-up payload", async () => {
    const f = await fixture();
    const deps = stubs("PRIVATE_SENTINEL I need quiet before deciding");
    await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, { db: t.db as never, ...deps });
    await t.sql`INSERT INTO background_jobs (profile_id, type, payload) VALUES (${f.profileId}, 'generate_reflection_question',
      ${JSON.stringify({ inspirationId: f.inspirationId, afterReflectionId: f.reflectionId, question: "PRIVATE_SENTINEL follow-up" })}::jsonb)`;
    await t.sql`DELETE FROM reflections WHERE id = ${f.reflectionId}`;
    const evidence = await t.sql`SELECT quote, reason FROM signal_evidence WHERE inspiration_id = ${f.inspirationId}`;
    expect(evidence).toHaveLength(1); // no semantic withdrawal inferred here
    expect(evidence[0]).toMatchObject({ quote: null, reason: null });
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'generate_reflection_question'`).toHaveLength(0);
  });

  it("replaces the first quote when an edited inspiration supplies current evidence", async () => {
    const f = await fixture();
    await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, { db: t.db as never, ...stubs("A walk by the water") });
    await t.sql`UPDATE inspirations SET text = 'A quiet morning before a decision' WHERE id = ${f.inspirationId}`;
    await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "edited" }, { db: t.db as never, ...stubs("A quiet morning before a decision") });
    const [evidence] = await t.sql`SELECT quote FROM signal_evidence WHERE inspiration_id = ${f.inspirationId}`;
    expect(evidence.quote).toBe("A quiet morning before a decision");
  });

  it("clears an edited answer's old citation immediately, then attributes its new wording", async () => {
    const f = await fixture();
    const first = await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, {
      db: t.db as never, ...stubs("PRIVATE_SENTINEL I need quiet before deciding"),
    });
    await t.sql`UPDATE reflections SET answer = 'I take time to think before deciding' WHERE id = ${f.reflectionId}`;
    const before = await getProfileSignal(t.db as never, { profileId: f.profileId, signalId: first.mintedSignalIds[0]! });
    expect(before?.evidence[0]).toMatchObject({ quote: null, quoteReflectionId: null, reason: null });
    await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "edited" }, {
      db: t.db as never, ...stubs("I take time to think before deciding"),
    });
    const after = await getProfileSignal(t.db as never, { profileId: f.profileId, signalId: first.mintedSignalIds[0]! });
    expect(after?.evidence).toHaveLength(1);
    expect(after?.evidence[0]).toMatchObject({ quote: "I take time to think before deciding", quoteReflectionId: f.reflectionId });
    expect(JSON.stringify(after)).not.toContain("PRIVATE_SENTINEL");
  });

  it.each(["inspiration", "reflection"])("rejects a stale personal pass after its %s changes", async (changed) => {
    const f = await fixture();
    const deps = stubs("PRIVATE_SENTINEL I need quiet before deciding");
    const original = deps.modelProvider.extractSignalCandidates;
    vi.spyOn(deps.modelProvider, "extractSignalCandidates").mockImplementation(async (input) => {
      if (changed === "inspiration") await t.sql`UPDATE inspirations SET text = 'I now choose differently' WHERE id = ${f.inspirationId}`;
      else await t.sql`DELETE FROM reflections WHERE id = ${f.reflectionId}`;
      return original(input);
    });
    await expect(deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, {
      db: t.db as never, ...deps,
    })).rejects.toThrow(/material changed/i);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE inspiration_id = ${f.inspirationId}`).toHaveLength(0);
  });

  it("keeps an omitted existing pattern when bounded extraction returns no new candidates", async () => {
    const f = await fixture();
    const deps = stubs("A walk by the water");
    await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, { db: t.db as never, ...deps });
    vi.spyOn(deps.modelProvider, "extractSignalCandidates").mockResolvedValue({ statements: [] });
    const result = await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "edited" }, { db: t.db as never, ...deps });
    expect(result.status).toBe("no_candidates");
    expect(await t.sql`SELECT id FROM signal_evidence WHERE inspiration_id = ${f.inspirationId}`).toHaveLength(1);
  });

  it("does not serve an untraceable legacy quote or reason as current evidence", async () => {
    const f = await fixture();
    const [signal] = await t.sql`INSERT INTO signals (profile_id, statement) VALUES (${f.profileId}, 'An old interpretation') RETURNING id`;
    await t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id, quote, quote_source, reason)
      VALUES (${f.profileId}, ${f.profileId}, ${signal.id}, ${f.inspirationId}, 'PRIVATE_SENTINEL untraceable quote', 'own', 'PRIVATE_SENTINEL old explanation')`;
    const view = await getProfileSignal(t.db as never, { profileId: f.profileId, signalId: signal.id as string });
    expect(view?.evidence[0]).toMatchObject({ quote: null, quoteSource: null, reason: null });
    expect(JSON.stringify(view)).not.toContain("PRIVATE_SENTINEL");
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${signal.id}`).toHaveLength(1);
  });

  it("does not let an empty extraction certify an obsolete source", async () => {
    const f = await fixture();
    const deps = stubs("unused");
    vi.spyOn(deps.modelProvider, "extractSignalCandidates").mockImplementation(async () => {
      await t.sql`DELETE FROM reflections WHERE id = ${f.reflectionId}`;
      return { statements: [] };
    });
    await expect(deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, { db: t.db as never, ...deps }))
      .rejects.toThrow(/material changed/i);
  });

  it("binds a quoted reflection to the same owner and inspiration in Postgres", async () => {
    const f = await fixture();
    await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, { db: t.db as never, ...stubs("A walk by the water") });
    const [other] = await t.sql`INSERT INTO inspirations (profile_id, text) VALUES (${f.profileId}, 'Another parent') RETURNING id`;
    const [answer] = await t.sql`INSERT INTO reflections (profile_id, inspiration_id, question, answer) VALUES (${f.profileId}, ${other.id}, 'Why?', 'Other answer') RETURNING id`;
    await expect(t.sql`UPDATE signal_evidence SET quote_reflection_id = ${answer.id} WHERE inspiration_id = ${f.inspirationId}`)
      .rejects.toThrow(/quote_reflection_fk/);
  });

  it("deletes personal vectors on answer removal without touching public vectors", async () => {
    const f = await fixture();
    await t.sql`UPDATE inspirations SET visibility = 'public' WHERE id = ${f.inspirationId}`;
    for (const inputScope of ["personal", "public"] as const) await ensureInspirationEmbedding({
      profileId: f.profileId, inspirationId: f.inspirationId, inputScope, db: t.db, client: stubs("").embeddingClient,
    });
    await t.sql`DELETE FROM reflections WHERE id = ${f.reflectionId}`;
    expect((await t.sql`SELECT input_scope FROM inspiration_embeddings WHERE inspiration_id = ${f.inspirationId}`).map((row) => row.input_scope))
      .toEqual(["public"]);
  });

  it("keeps another reflection's verified quote when an unrelated answer is removed", async () => {
    const f = await fixture();
    const [other] = await t.sql`INSERT INTO reflections (profile_id, inspiration_id, question, answer)
      VALUES (${f.profileId}, ${f.inspirationId}, 'What else?', 'A different surviving answer') RETURNING id`;
    await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, { db: t.db as never, ...stubs("A different surviving answer") });
    await t.sql`DELETE FROM reflections WHERE id = ${f.reflectionId}`;
    const [row] = await t.sql`SELECT quote, quote_reflection_id, reason FROM signal_evidence WHERE inspiration_id = ${f.inspirationId}`;
    expect(row).toMatchObject({ quote: "A different surviving answer", quote_reflection_id: other.id, reason: null });
  });

  it("cannot attach a private answer quote to a room signal even through direct SQL", async () => {
    const f = await fixture();
    const group = await createGroupForProfile(t.db as never, { profileId: f.profileId, name: "A room" });
    const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id = ${group.id}`;
    const [signal] = await t.sql`INSERT INTO signals (profile_id, statement) VALUES (${mind.id}, 'A room pattern') RETURNING id`;
    await expect(t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id, quote, quote_source, quote_reflection_id, quote_source_hash)
      VALUES (${mind.id}, ${f.profileId}, ${signal.id}, ${f.inspirationId}, 'Private answer', 'own', ${f.reflectionId}, 'hash')`)
      .rejects.toThrow(/private_quote_check/);
  });

  it("does not save an embedding of an answer deleted while the provider is working", async () => {
    const f = await fixture();
    const client = stubs("").embeddingClient;
    client.embed = async () => {
      const concurrent = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
      try { await concurrent`DELETE FROM reflections WHERE id = ${f.reflectionId}`; }
      finally { await concurrent.end(); }
      return [1, ...new Array<number>(767).fill(0)];
    };
    const result = await ensureInspirationEmbedding({ profileId: f.profileId, inspirationId: f.inspirationId, db: t.db, client });
    expect(result.status).toBe("stale_source");
    expect(await t.sql`SELECT id FROM inspiration_embeddings WHERE inspiration_id = ${f.inspirationId}`).toHaveLength(0);
  });

  it("rejects a human-edited match target before attaching evidence", async () => {
    const f = await fixture();
    const first = await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "created" }, { db: t.db as never, ...stubs("A walk by the water") });
    const [next] = await t.sql`INSERT INTO inspirations (profile_id, text) VALUES (${f.profileId}, 'A new current note') RETURNING id`;
    const deps = stubs("A new current note");
    deps.embeddingClient.embed = async () => [0.8, 0.6, ...new Array<number>(766).fill(0)];
    vi.spyOn(deps.modelProvider, "judgeSignalMatch").mockImplementation(async () => {
      const concurrent = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
      try { await concurrent`UPDATE signals SET statement = 'My new locked wording', locked_at = now() WHERE id = ${first.mintedSignalIds[0]!}`; }
      finally { await concurrent.end(); }
      return { relation: "same" };
    });
    await expect(deriveSignalsForInspiration({ inspirationId: next.id as string, reason: "created" }, { db: t.db as never, ...deps }))
      .rejects.toThrow(/Signal inputs changed/);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE inspiration_id = ${next.id}`).toHaveLength(0);
    expect((await t.sql`SELECT statement FROM signals WHERE id = ${first.mintedSignalIds[0]!}`)[0].statement).toBe("My new locked wording");
  });
});
