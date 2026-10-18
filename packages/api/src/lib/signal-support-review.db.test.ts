import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../db/index.js";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { reviewSignalSupport } from "./signal-support-review.js";
import { applySignalSupportReview } from "./signal-support-apply.js";
import { dismissProfileSignal } from "../routes/signals.js";
import { deriveSignalsForInspiration } from "./signal-derivation.js";
import { writeSignalEmbedding } from "./signal-embeddings.js";
import { acquireSignalDerivationLock, applyCandidates } from "./signal-match-or-mint.js";
import type { ModelProvider } from "./model-provider.js";
import type { SignalSupportAssessmentInput } from "./model-provider.js";

let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

/* The `group` flag went with the rooms (founder: "방 없애"). It swapped the
   derivation destination from the person to a room's mind and stamped the
   claim `group-public-v1`, so the four room cases could ask the public-scope
   questions. One destination now, and it is the owner. */
async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts (email) VALUES (${`support-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [inspiration] = await t.sql`INSERT INTO inspirations (profile_id, text, visibility)
    VALUES (${profile.id}, 'I enjoy a quiet morning', 'public') RETURNING id`;
  const [reflection] = await t.sql`INSERT INTO reflections (profile_id, inspiration_id, question, answer)
    VALUES (${profile.id}, ${inspiration.id}, 'Why?', 'PRIVATE_SENTINEL I need quiet before decisions') RETURNING id`;
  const [signal] = await t.sql`INSERT INTO signals (profile_id, statement, locked_at)
    VALUES (${profile.id}, 'I choose quiet before making decisions', now()) RETURNING id`;
  await t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
    VALUES (${profile.id}, ${profile.id}, ${signal.id}, ${inspiration.id})`;
  return { ownerProfileId: profile.id as string, inspirationId: inspiration.id as string,
    reflectionId: reflection.id as string, signalId: signal.id as string };
}
function provider(verdict: "supported" | "unsupported" | "unresolved") {
  return { assessSignalSupport: vi.fn(async (input: SignalSupportAssessmentInput) => ({
    assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict,
      sourceIds: verdict === "supported" ? [input.sources[0]!.id] : [] })),
  })) };
}

describe("read-only evidence support assessment", () => {
  it("invalidates changed-and-restored material even when its content hash returns to the same value", async () => {
    const f = await fixture();
    const model = provider("supported");
    const original = model.assessSignalSupport.getMockImplementation()!;
    model.assessSignalSupport.mockImplementation(async (input) => {
      await t.sql`UPDATE inspirations SET text = 'Temporary edit' WHERE id = ${f.inspirationId}`;
      await t.sql`UPDATE inspirations SET text = 'I enjoy a quiet morning' WHERE id = ${f.inspirationId}`;
      return original(input);
    });
    const report = await reviewSignalSupport(t.db as never, { ...f, provider: model, maxCalls: 1 });
    expect(report.status).toBe('stale');
    expect(report.items[0]).toMatchObject({ verdict: 'unresolved', issue: 'inputs_changed' });
  });

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

  /* ── TWO PUBLIC-SCOPE ROOM CASES, DELETED ─────────────────────────────
     Founder: "방 없애". "keeps private answers and legacy room wording out
     of a public review" was the privacy gate on the room's review: the model
     saw the public capture and never the owner's private answer, legacy
     claims without `group-public-v1` were counted as restricted rather than
     reviewed, and editing a private answer left the public material hash
     untouched so no re-review was provoked. Every clause of that is a
     statement about a review run for SOMEBODY ELSE'S eyes. A personal review
     is the owner's own, private answers included, so there is no second
     audience to keep anything from, and `restrictedClaimCount` has nothing
     to count.

     "invalidates a room review if the member leaves during the call" pinned
     the membership re-read: the seat is checked before the model call and
     again after, so leaving mid-call makes the report stale rather than
     applicable, and the next attempt refuses outright. No seats, no leaving,
     nothing to re-read. */

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

describe("applying explicit support decisions", () => {
  async function review(f: Awaited<ReturnType<typeof fixture>>, verdict: "supported" | "unsupported" | "unresolved") {
    return reviewSignalSupport(t.db as never, { ...f, provider: provider(verdict), maxCalls: 1 });
  }

  it("withdraws a locked signal's last witness but keeps its words, with a durable reading request", async () => {
    const f = await fixture();
    const outcome = await applySignalSupportReview(t.db as never, await review(f, "unsupported"));
    expect(outcome.withdrawn).toEqual([f.signalId]);
    expect(outcome.jobId).toBeTruthy();
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(0);
    const [signal] = await t.sql`SELECT statement, locked_at, unsupported_at FROM signals WHERE id = ${f.signalId}`;
    expect(signal.statement).toBe("I choose quiet before making decisions");
    expect(signal.locked_at).not.toBeNull();
    expect(signal.unsupported_at).not.toBeNull();
    expect((await t.sql`SELECT type, status FROM background_jobs WHERE id = ${outcome.jobId!}`)[0])
      .toMatchObject({ type: "refresh_top_of_mind", status: "pending" });
  });

  it("restores a mistaken withdrawal without resurrecting a copied quote or inflating witnesses", async () => {
    const f = await fixture();
    await t.sql`UPDATE signals SET locked_at = NULL WHERE id = ${f.signalId}`;
    const negative = await review(f, "unsupported");
    const first = await applySignalSupportReview(t.db as never, negative);
    const [retired] = await t.sql`SELECT status, support_retired_at FROM signals WHERE id = ${f.signalId}`;
    expect(retired.status).toBe("retired");
    expect(Number.isFinite(new Date(retired.support_retired_at).getTime())).toBe(true);
    const positive = await review(f, "supported");
    expect(positive.items).toHaveLength(1); // recovered from metadata, not the deleted link
    const restored = await applySignalSupportReview(t.db as never, positive);
    expect(restored.restored).toEqual([f.signalId]);
    expect(restored.jobId).toBe(first.jobId); // existing pending refresh coalesces
    expect((await t.sql`SELECT status, support_retired_at FROM signals WHERE id = ${f.signalId}`)[0])
      .toMatchObject({ status: "emerging", support_retired_at: null });
    const rows = await t.sql`SELECT quote, reason FROM signal_evidence WHERE signal_id = ${f.signalId}`;
    expect(rows).toEqual([{ quote: null, reason: null }]);
    expect((await applySignalSupportReview(t.db as never, positive)).alreadyApplied).toBe(true);
    expect((await applySignalSupportReview(t.db as never, negative)).alreadyApplied).toBe(true);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(1);
    const records = await t.sql`SELECT * FROM signal_support_reviews WHERE signal_id = ${f.signalId}`;
    expect(records).toHaveLength(2);
    expect(JSON.stringify(records)).not.toContain("PRIVATE_SENTINEL");
  });

  it.each(["dismissal", "merge"])("support recovery does not reverse a %s", async (cause) => {
    const f = await fixture();
    await t.sql`UPDATE signals SET locked_at = NULL WHERE id = ${f.signalId}`;
    await applySignalSupportReview(t.db as never, await review(f, "unsupported"));
    if (cause === "dismissal") await dismissProfileSignal(t.db as never, { profileId: f.ownerProfileId, signalId: f.signalId });
    else await t.sql`UPDATE signals SET status = 'retired', support_retired_at = NULL WHERE id = ${f.signalId}`;
    const outcome = await applySignalSupportReview(t.db as never, await review(f, "supported"));
    expect(outcome.restored).toEqual([]);
    expect((await t.sql`SELECT status FROM signals WHERE id = ${f.signalId}`)[0].status).toBe("retired");
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(0);
  });

  it("unresolved checks neither remove support nor schedule a fabricated change", async () => {
    const f = await fixture();
    const before = await t.sql`SELECT * FROM signal_evidence WHERE signal_id = ${f.signalId}`;
    const result = await applySignalSupportReview(t.db as never, await review(f, "unresolved"));
    expect(result).toMatchObject({ withdrawn: [], restored: [], jobId: null });
    expect(await t.sql`SELECT * FROM signal_evidence WHERE signal_id = ${f.signalId}`).toEqual(before);
  });

  it("applies a report written before rooms retired, but never one that names a membership", async () => {
    /* Report files saved before 2026-10-17 carry `membershipId: null` and
       `restrictedClaimCount: 0`. They still apply; a membership is room
       work and is refused by the schema. */
    const f = await fixture();
    const legacy = { ...(await review(f, "unresolved")), membershipId: null, restrictedClaimCount: 0 };
    await expect(applySignalSupportReview(t.db as never, legacy)).resolves.toMatchObject({ alreadyApplied: false });
    const withMembership = { ...(await review(f, "unresolved")), membershipId: f.signalId, restrictedClaimCount: 0 };
    await expect(applySignalSupportReview(t.db as never, withMembership)).rejects.toThrow();
  });

  it.each([true, false])("bounded discovery cannot undo explicit withdrawal (locked=%s)", async (locked) => {
    const f = await fixture();
    if (!locked) await t.sql`UPDATE signals SET locked_at = NULL WHERE id = ${f.signalId}`;
    const vector = [1, ...new Array<number>(767).fill(0)];
    await t.db.transaction(async (tx) => writeSignalEmbedding(tx as never, { profileId: f.ownerProfileId,
      signalId: f.signalId, statement: "I choose quiet before making decisions", embedding: vector, model: "support-test" }));
    await applySignalSupportReview(t.db as never, await review(f, "unsupported"));
    await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: "edited" }, {
      db: t.db as never,
      embeddingClient: { model: "support-test", embed: async () => vector },
      modelProvider: { extractSignalCandidates: async () => ({ statements: [{ statement: "I choose quiet before making decisions" }] }),
        judgeSignalMatch: async () => ({ relation: "same" }) } as unknown as ModelProvider,
    });
    expect(await t.sql`SELECT id FROM signal_evidence WHERE inspiration_id = ${f.inspirationId}`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM signals WHERE profile_id = ${f.ownerProfileId}`).toHaveLength(1);
  });

  it("the database refuses an old writer reattaching an explicitly withdrawn link", async () => {
    const f = await fixture();
    await applySignalSupportReview(t.db as never, await review(f, "unsupported"));
    await expect(t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${f.ownerProfileId}, ${f.ownerProfileId}, ${f.signalId}, ${f.inspirationId})`).rejects.toThrow(/withdrawn support/);
  });

  it("an unresolved follow-up cannot erase the last explicit withdrawal", async () => {
    const f = await fixture();
    await applySignalSupportReview(t.db as never, await review(f, "unsupported"));
    await applySignalSupportReview(t.db as never, await review(f, "unresolved"));
    await expect(t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${f.ownerProfileId}, ${f.ownerProfileId}, ${f.signalId}, ${f.inspirationId})`).rejects.toThrow(/withdrawn support/);
  });

  it("an old insert waiting on withdrawal rechecks the committed decision", async () => {
    const f = await fixture();
    const report = await review(f, "unsupported");
    const applicationName = `support-race-${t.schemaName}`;
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false,
      connection: { search_path: t.schemaName, application_name: applicationName } });
    let attempt: Promise<unknown> | undefined;
    try {
      await t.sql.begin(async (tx) => {
        await tx`SELECT id FROM signals WHERE id = ${f.signalId} FOR NO KEY UPDATE`;
        await tx`INSERT INTO signal_support_reviews (review_id, signal_id, profile_id, owner_profile_id, inspiration_id,
          review_hash, statement_hash, material, verdict, source_ids)
          VALUES (${report.reviewId}, ${f.signalId}, ${f.ownerProfileId}, ${f.ownerProfileId}, ${f.inspirationId},
            'test', ${report.items[0]!.statementHash}, ${JSON.stringify(report.material)}::jsonb, 'unsupported', ARRAY[]::uuid[])`;
        await tx`DELETE FROM signal_evidence WHERE signal_id = ${f.signalId}`;
        // Start the older writer before this transaction commits. Its guard
        // must wait, not accept the earlier absence of a committed decision.
        attempt = other`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
          VALUES (${f.ownerProfileId}, ${f.ownerProfileId}, ${f.signalId}, ${f.inspirationId})`
          .then(() => ({ inserted: true }), (error: Error) => ({ error: error.message }));
        let waiting = false;
        for (let i = 0; i < 50; i++) {
          await tx`SELECT pg_stat_clear_snapshot()`;
          const [state] = await tx`SELECT wait_event_type FROM pg_stat_activity WHERE application_name = ${applicationName}`;
          if (state?.wait_event_type === "Lock") { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting, "the old insert must reach a lock wait before withdrawal commits").toBe(true);
      });
      expect(await attempt).toMatchObject({ error: expect.stringMatching(/withdrawn support/) });
      expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(0);
    } finally { await other.end(); }
  });

  it("related-source discovery cannot restore another inspiration's withdrawn link", async () => {
    const f = await fixture();
    const vector = [1, ...new Array<number>(767).fill(0)];
    await t.db.transaction(async (tx) => writeSignalEmbedding(tx as never, { profileId: f.ownerProfileId,
      signalId: f.signalId, statement: "I choose quiet before making decisions", embedding: vector, model: "support-test" }));
    await applySignalSupportReview(t.db as never, await review(f, "unsupported"));
    const [next] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${f.ownerProfileId}, 'A new independent choice') RETURNING id`;
    await t.db.transaction(async (tx) => {
      await acquireSignalDerivationLock(tx as never, f.ownerProfileId);
      await applyCandidates(tx as never, { profileId: f.ownerProfileId, evidenceOwnerProfileId: f.ownerProfileId,
        inspirationId: next.id as string, embeddingModel: "support-test", preferredLocale: "en-US", now: new Date(),
        provider: { judgeSignalMatch: async () => ({ relation: "same" }) } as unknown as ModelProvider,
        beforeWrites: async () => {}, // synthetic matching fixture, not the source-loader path
        candidates: [{ statement: "I choose quiet before making decisions", reason: null, quote: null, quoteSource: null,
          embedding: vector, relatedEvidence: [{ inspirationId: f.inspirationId, quote: "I enjoy a quiet morning" }] }],
      });
    });
    expect((await t.sql`SELECT inspiration_id FROM signal_evidence WHERE signal_id = ${f.signalId}`).map((row) => row.inspiration_id))
      .toEqual([next.id]);
  });

  it("concurrent application of one report commits once", async () => {
    const f = await fixture();
    const report = await review(f, "unsupported");
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    try {
      const outcomes = await Promise.all([
        applySignalSupportReview(t.db as never, report), applySignalSupportReview(drizzle(other, { schema }), report),
      ]);
      expect(outcomes.map((row) => row.alreadyApplied).sort()).toEqual([false, true]);
      expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(1);
      expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(1);
    } finally { await other.end(); }
  });

  it.each(["source", "statement", "prior_review"])("rejects a report after its %s changed", async (change) => {
    const f = await fixture();
    const negative = await review(f, "unsupported");
    if (change === "source") await t.sql`DELETE FROM reflections WHERE id = ${f.reflectionId}`;
    else if (change === "statement") await t.sql`UPDATE signals SET statement = 'New owner words' WHERE id = ${f.signalId}`;
    else await applySignalSupportReview(t.db as never, await review(f, "unresolved"));
    await expect(applySignalSupportReview(t.db as never, negative)).rejects.toThrow(/changed/);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  });

  it("rolls evidence and review records back if the durable job cannot be saved", async () => {
    const f = await fixture();
    const negative = await review(f, "unsupported");
    await t.sql`CREATE FUNCTION reject_support_job() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'job storage unavailable'; END; $$ LANGUAGE plpgsql`;
    await t.sql`CREATE TRIGGER reject_support_job BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION reject_support_job()`;
    try {
      await expect(applySignalSupportReview(t.db as never, negative)).rejects.toMatchObject({
        cause: expect.objectContaining({ message: "job storage unavailable" }),
      });
      expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(1);
      expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(0);
      expect((await t.sql`SELECT unsupported_at FROM signals WHERE id = ${f.signalId}`)[0].unsupported_at).toBeNull();
    } finally {
      await t.sql`DROP TRIGGER reject_support_job ON background_jobs`;
      await t.sql`DROP FUNCTION reject_support_job()`;
    }
  });

  /* ── THE APPLY-SIDE ROOM CASES, DELETED ───────────────────────────────
     Founder: "방 없애". "rejects a group report after a %s change"
     (visibility / membership) guarded the gap between reviewing and
     applying: a report assembled while a capture was public and its owner
     seated must be refused if either changed before the write landed, so a
     withdrawn memory or a departed member could never retire a room's
     evidence. Both conditions are room conditions.

     THE GENERAL RULE SURVIVES, in `applySignalSupportReview` itself and in
     the cases above it here: a report whose material moved under it is
     refused. What goes is the pair of room-shaped ways material could move.

     "persists group refresh work with the member as billing owner" pinned
     that a room's regeneration is billed to a PERSON, because a room's mind
     has no account to charge.

     CORRECTION (2026-10-15), THEN SETTLED (2026-10-17). On 10-15 the job
     was still live and this rule was untested rather than retired. It is
     retired now: `refreshTopOfMindForGroup` is deleted, the room support
     review path is gone (`applySignalSupportReview` refuses a report landing
     on another profile), and a queued `refresh_group_top_of_mind` settles
     unrun — pinned in `retired-group-jobs.db.test.ts`. If rooms ever return,
     their billing rule returns with them. */

  it.each(["held", "contested"])("preserves edited %s principles and recovers their support", async (state) => {
    const f = await fixture();
    // This test starts from an already-demonstrated principle. Certify the
    // fixture's reflection-bearing witness before its historical promotion;
    // a null legacy material revision must not bypass the current-source bar.
    await applySignalSupportReview(t.db as never,await review(f,"supported"));
    const ids = [f.signalId];
    for (let i = 0; i < 2; i++) {
      const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${f.ownerProfileId}, ${`Other pattern ${i}`}) RETURNING id`;
      ids.push(signal.id as string);
    }
    for (const signalId of ids) {
      const extraSources: string[] = [];
      for (let n = 0; n < (signalId === f.signalId ? 2 : 3); n++) {
        const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${f.ownerProfileId}, 'Independent material') RETURNING id`;
        await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
          VALUES (${f.ownerProfileId}, ${f.ownerProfileId}, ${signalId}, ${source.id})`;
        extraSources.push(source.id as string);
      }
      await t.sql`UPDATE signals SET status = 'active' WHERE id = ${signalId}`;
      // A previously active pattern remains active after ordinary partial
      // evidence loss. The reviewed link is now its final witness.
      if (signalId === f.signalId) for (const id of extraSources) await t.sql`DELETE FROM inspirations WHERE id = ${id}`;
    }
    const [tom] = await t.sql`INSERT INTO top_of_minds(profile_id) VALUES (${f.ownerProfileId}) RETURNING id`;
    const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id, type, body) VALUES (${tom.id}, 'pattern', 'A reading') RETURNING id`;
    const [principle] = await t.sql`INSERT INTO principles(profile_id, statement, state, origin, rank, locked_at, held_since)
      VALUES (${f.ownerProfileId}, 'The words I chose', ${state}, 'minted', 1, now(), now()) RETURNING id`;
    for (const id of ids) {
      await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id, signal_id) VALUES (${entry.id}, ${id})`;
      await t.sql`INSERT INTO principle_signals(profile_id, principle_id, signal_id) VALUES (${f.ownerProfileId}, ${principle.id}, ${id})`;
    }
    await applySignalSupportReview(t.db as never, await review(f, "unsupported"));
    const [lost] = await t.sql`SELECT statement, state, unsupported_at FROM principles WHERE id = ${principle.id}`;
    expect(lost).toMatchObject({ statement: "The words I chose", state: state === "contested" ? "contested" : "aspirational" });
    expect(lost.unsupported_at).not.toBeNull();
    await applySignalSupportReview(t.db as never, await review(f, "supported"));
    expect((await t.sql`SELECT statement, state, unsupported_at FROM principles WHERE id = ${principle.id}`)[0])
      .toMatchObject({ statement: "The words I chose", state, unsupported_at: null });
  });
});
