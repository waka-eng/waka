/** Real SQL proves room history, privacy and queue identity. Only the model is scripted. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {randomUUID} from 'node:crypto';
import { Hono } from "hono";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createGroupForProfile } from "../routes/groups-membership.js";
import { createGroupsRoutes } from "../routes/groups.js";
import { loadPrincipleViews, renderPrinciplesMarkdown, undoPrincipleDispute } from "../routes/principles.js";
import { createFeedbackForProfile } from "../routes/feedback.js";
import { loadPrincipleMaterial, promoteIfDemonstrated, refreshPrinciplesForProfile, reconcilePrinciplesAfterSignalLoss } from "./principle-generation.js";
import { requestPrincipleRefresh, loadPrincipleStatus, principleMaterialKey } from "./principle-status.js";
import type { ModelProvider } from "./model-provider.js";
import { reviewSignalSupport } from './signal-support-review.js';
import { applySignalSupportReview } from './signal-support-apply.js';
import {createReviewSession} from './review-sessions.js';
import {loadReviewAnswerMaterial} from './review-answer-material.js';
import {writeReviewEvidence} from './review-evidence.js';

let t: TestDatabase;
let owner: string;
let other: string;
let groupId: string;
let mindId: string;
let sequence = 0;

async function person() {
  const [a] = await t.sql`INSERT INTO accounts(email) VALUES (${`principle-flow-${sequence++}@example.test`}) RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${a.id},'human','Test') RETURNING id`;
  return p.id as string;
}

async function material(profileId: string, owners: string[], targetGroupId?: string) {
  const ids: string[] = [];
  for (let n = 0; n < 3; n++) {
    const [s] = await t.sql`INSERT INTO signals(profile_id,statement,input_policy)
      VALUES (${profileId},${`Pattern ${n}`},${targetGroupId ? "group-public-v1" : null}) RETURNING id`;
    for (let i = 0; i < 3; i++) {
      const author = owners[i % owners.length]!;
      const [inspirationRow] = await t.sql`INSERT INTO inspirations(profile_id,text,visibility)
        VALUES (${author},'PRIVATE RAW TEXT MUST NEVER LEAVE','public') RETURNING id`;
      await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
        VALUES (${profileId},${author},${s.id},${inspirationRow.id})`;
    }
    await t.sql`UPDATE signals SET status='active' WHERE id=${s.id}`;
    ids.push(s.id as string);
  }
  const [tom] = targetGroupId
    ? await t.sql`INSERT INTO top_of_minds(group_id) VALUES (${targetGroupId}) RETURNING id`
    : await t.sql`INSERT INTO top_of_minds(profile_id) VALUES (${profileId}) RETURNING id`;
  const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,input_policy)
    VALUES (${tom.id},'pattern','A present focus',${targetGroupId ? "group-public-v1" : null}) RETURNING id`;
  for (const id of ids) await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES (${entry.id},${id})`;
  return ids;
}

const provider = {
  distillPrinciples: async (input: { signals: Array<{ id: string }> }) => ({ candidates: [{
    statement: "Prefer small, reversible experiments.", type: "maxim", citedSignalIds: input.signals.map((s) => s.id),
  }] }),
  judgePrincipleRelation: async (input:Parameters<ModelProvider['judgePrincipleRelation']>[0]) => ({ relations:input.existingPrinciples.map(row=>({principleId:row.id,relation:"same" as const})) }),
} as unknown as ModelProvider;

beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
  process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = "0";
  owner = await person(); other = await person();
  const group = await createGroupForProfile(t.db as never, { profileId: owner, name: "Principle test" });
  groupId = group.id;
  await t.sql`INSERT INTO group_members(group_id,profile_id) VALUES (${groupId},${other})`;
  const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id=${groupId}`;
  mindId = mind.id as string;
});
afterAll(async () => { await t?.cleanup(); });

describe("principles across personal and room profiles", () => {
  it('changes work identity after a source edit is revalidated without changing its capture date',async()=>{
    const profileId=await person();
    await material(profileId,[profileId]);
    const before=principleMaterialKey(await loadPrincipleMaterial(t.db as never,profileId));
    const [source]=await t.sql`SELECT id,created_at FROM inspirations WHERE profile_id=${profileId} ORDER BY id LIMIT 1`;
    await t.sql`UPDATE inspirations SET text='The edited wording now qualifies the same pattern.' WHERE id=${source.id}`;
    // Simulate the committed support-review result, not an external model call.
    await t.sql`UPDATE signal_evidence e SET material_revision=r.personal_revision
      FROM inspiration_revisions r WHERE e.inspiration_id=r.inspiration_id AND e.owner_profile_id=r.profile_id
      AND e.profile_id=${profileId} AND e.inspiration_id=${source.id}`;
    const after=await loadPrincipleMaterial(t.db as never,profileId);
    expect(after.eligibility.eligible).toBe(true);
    expect(principleMaterialKey(after)).not.toBe(before);
    const afterEdit=principleMaterialKey(after);
    await t.sql`INSERT INTO reflections(profile_id,inspiration_id,question,answer)
      VALUES(${profileId},${source.id},'What matters here?','I want to leave space for exceptions.')`;
    await t.sql`UPDATE signal_evidence e SET material_revision=r.personal_revision
      FROM inspiration_revisions r WHERE e.inspiration_id=r.inspiration_id AND e.owner_profile_id=r.profile_id
      AND e.profile_id=${profileId} AND e.inspiration_id=${source.id}`;
    expect(principleMaterialKey(await loadPrincipleMaterial(t.db as never,profileId))).not.toBe(afterEdit);
    const [unchangedDate]=await t.sql`SELECT created_at FROM inspirations WHERE id=${source.id}`;
    expect(unchangedDate.created_at).toEqual(source.created_at);
  });
  it('fingerprints an edited review answer but not a repeated support check',async()=>{
    const profileId=await person();
    const signalIds=await material(profileId,[profileId]);
    const [source]=await t.sql`SELECT inspiration_id FROM signal_evidence WHERE signal_id=${signalIds[0]!} ORDER BY inspiration_id LIMIT 1`;
    const session=(await createReviewSession(t.db as never,profileId,{id:randomUUID(),inspirationIds:[source.inspiration_id]}))!;
    const answerId=randomUUID();
    await t.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,question,answer,source_count)
      VALUES(${answerId},${profileId},${session.id},${randomUUID()},'fixture','fixture','What stays with you?','I favor small steps.',1)`;
    await t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced)
      VALUES(${profileId},${session.id},${answerId},${source.inspiration_id},1,true)`;
    const record=async()=>{
      const current=await loadReviewAnswerMaterial(t.db as never,profileId,answerId);
      expect(current).not.toBeNull();
      await t.db.transaction(tx=>writeReviewEvidence(tx as never,current!,signalIds[0]!));
    };
    await record();
    const before=principleMaterialKey(await loadPrincipleMaterial(t.db as never,profileId));
    await t.sql`UPDATE review_answers SET answer='I favor small steps except when a deadline is fixed.' WHERE id=${answerId}`;
    await record();
    const after=principleMaterialKey(await loadPrincipleMaterial(t.db as never,profileId));
    expect(after).not.toBe(before);
    await record();
    expect(principleMaterialKey(await loadPrincipleMaterial(t.db as never,profileId))).toBe(after);
  });
  it('does not buy another principle pass for an unchanged reading audit version',async()=>{
    const profileId=await person();
    const signalIds=await material(profileId,[profileId]);
    const before=principleMaterialKey(await loadPrincipleMaterial(t.db as never,profileId));
    await requestPrincipleRefresh(t.db as never,profileId);
    await t.sql`UPDATE background_jobs SET status='succeeded' WHERE profile_id=${profileId} AND type='refresh_principles'`;
    await t.sql`UPDATE top_of_minds SET status='superseded' WHERE profile_id=${profileId}`;
    const [next]=await t.sql`INSERT INTO top_of_minds(profile_id,version,reason) VALUES(${profileId},2,'no_change') RETURNING id`;
    const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${next.id},'pattern','A present focus') RETURNING id`;
    for(const id of signalIds)await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES(${entry.id},${id})`;
    const after=await loadPrincipleMaterial(t.db as never,profileId);
    expect(after.eligibility.eligible).toBe(true);
    expect(after.eligibility.tomAppearances).toBe(1);
    expect.soft(principleMaterialKey(after)).toBe(before);
    await requestPrincipleRefresh(t.db as never,profileId);
    expect.soft(await t.sql`SELECT id FROM background_jobs WHERE profile_id=${profileId} AND type='refresh_principles'`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id=${profileId}`).toHaveLength(2);
    await t.sql`UPDATE profiles SET preferred_locale='ko-KR' WHERE id=${profileId}`;
    expect(principleMaterialKey(await loadPrincipleMaterial(t.db as never,profileId))).not.toBe(before);
    await t.sql`UPDATE profiles SET preferred_locale='en-US' WHERE id=${profileId}`;
    await t.sql`UPDATE top_of_minds SET status='superseded' WHERE profile_id=${profileId}`;
    const [changed]=await t.sql`INSERT INTO top_of_minds(profile_id,version,reason) VALUES(${profileId},3,'human_edit') RETURNING id`;
    const [humanEntry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${changed.id},'pattern','My own wording for this focus') RETURNING id`;
    for(const id of signalIds)await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES(${humanEntry.id},${id})`;
    expect(principleMaterialKey(await loadPrincipleMaterial(t.db as never,profileId))).not.toBe(before);
    await requestPrincipleRefresh(t.db as never,profileId);
    expect(await t.sql`SELECT id FROM background_jobs WHERE profile_id=${profileId} AND type='refresh_principles'`).toHaveLength(2);
  });
  it('uses current citations on an unchanged reading instead of dropping refreshed support',async()=>{
    const profileId=await person();
    await material(profileId,[profileId]);
    const before=principleMaterialKey(await loadPrincipleMaterial(t.db as never,profileId));
    await t.sql`UPDATE signals SET statement=statement || ' revised' WHERE profile_id=${profileId}`;
    await t.sql`UPDATE signal_evidence e SET statement_revision=s.statement_revision FROM signals s WHERE e.signal_id=s.id AND s.profile_id=${profileId}`;
    await t.sql`UPDATE top_of_minds SET status='superseded' WHERE profile_id=${profileId}`;
    const [next]=await t.sql`INSERT INTO top_of_minds(profile_id,version,reason) VALUES(${profileId},2,'no_change') RETURNING id`;
    const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${next.id},'pattern','A present focus') RETURNING id`;
    await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id,statement_revision)
      SELECT ${entry.id},id,statement_revision FROM signals WHERE profile_id=${profileId}`;
    const current=await loadPrincipleMaterial(t.db as never,profileId);
    expect(current.eligibility.eligible).toBe(true);
    expect(current.eligibility.tomAppearances).toBe(1);
    expect(principleMaterialKey(current)).not.toBe(before);
  });
  it.each(["held", "contested"] as const)("keeps edited %s wording after support is lost", async (state) => {
    const profileId = await person();
    const signalIds = await material(profileId, [profileId]);
    const [p] = await t.sql`INSERT INTO principles(profile_id, statement, state, origin, rank, locked_at, held_since)
      VALUES (${profileId}, 'These are the words I chose.', ${state}, 'minted', 1, now(), now()) RETURNING id`;
    for (const id of signalIds) await t.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id)
      VALUES (${profileId},${p.id},${id})`;
    await t.sql`UPDATE signals SET status='retired' WHERE id=${signalIds[0]!}`;
    await reconcilePrinciplesAfterSignalLoss(t.db as never, { profileId, signalIds: [signalIds[0]!] });
    const rows = await t.sql`SELECT * FROM principles WHERE id=${p.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.statement).toBe('These are the words I chose.');
    expect(rows[0]!.locked_at).not.toBeNull();
    expect(rows[0]!.unsupported_at).not.toBeNull();
    expect(rows[0]!.state).toBe(state === 'contested' ? 'contested' : 'aspirational');
    const views = await loadPrincipleViews(t.db as never, profileId);
    expect(views[0]!.unsupported).toBe(true);
    expect(renderPrinciplesMarkdown({ name: 'Test', type: 'human' }, views, new Date()))
      .toContain('Supporting evidence has been withdrawn.');
    if (state === 'held') {
      const verdict = await createFeedbackForProfile(t.db as never, {
        profileId, targetType: 'principle', targetId: p.id, value: 'not_true',
      });
      await undoPrincipleDispute(t.db as never, profileId, p.id, verdict!.id);
      const [afterUndo] = await t.sql`SELECT state FROM principles WHERE id=${p.id}`;
      expect(afterUndo.state).toBe('aspirational');
    }
    await t.sql`UPDATE signals SET status='active' WHERE id=${signalIds[0]!}`;
    expect(await promoteIfDemonstrated(t.db as never, profileId, p.id, new Date())).toBe(true);
    const [restored] = await t.sql`SELECT * FROM principles WHERE id=${p.id}`;
    expect(restored.unsupported_at).toBeNull();
    expect(restored.statement).toBe('These are the words I chose.');
    expect(restored.state).toBe(state);
  });
  it("creates a personal principle from recent evidence and keeps locked words on a later match", async () => {
    await material(owner, [owner]);
    expect((await loadPrincipleMaterial(t.db as never, owner)).eligibility.eligible).toBe(true);
    const result = await refreshPrinciplesForProfile({ profileId: owner }, { db: t.db as never, modelProvider: provider });
    expect(result.minted).toBe(1);
    await t.sql`UPDATE principles SET statement='My own words', locked_at=now() WHERE profile_id=${owner}`;
    await refreshPrinciplesForProfile({ profileId: owner }, { db: t.db as never, modelProvider: provider });
    const [row] = await t.sql`SELECT statement FROM principles WHERE profile_id=${owner}`;
    expect(row.statement).toBe("My own words");
  });

  it("uses room history, serves only room signal statements and withdraws unsupported room principles", async () => {
    await material(mindId, [owner, other], groupId);
    const before = await loadPrincipleMaterial(t.db as never, mindId);
    expect(before.eligibility.tomAppearances).toBe(1);
    expect(before.eligibility.eligible).toBe(true);
    expect((await refreshPrinciplesForProfile({ profileId: mindId }, { db: t.db as never, modelProvider: provider })).minted).toBe(1);
    const app = new Hono();
    app.route("/groups", createGroupsRoutes({ getDatabase: () => t.db as never,
      authMiddleware: async (c, next) => {
        c.set("session", { sessionId: "test", account: { id: "test", email: "test@example.test" },
          profile: { id: owner, accountId: "test", type: "human", name: "Test", preferredLocale: "en-US" } });
        await next();
      },
    }));
    const response = await app.request(`/groups/${groupId}/principles`);
    expect(response.status).toBe(200);
    const body = await response.json() as { principles: Array<{ citedSignals: unknown[] }> };
    expect(body.principles).toHaveLength(1);
    expect(body.principles[0]!.citedSignals).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain("PRIVATE RAW TEXT");
    await t.sql`UPDATE inspirations SET visibility='private' WHERE profile_id=${other}`;
    expect((await loadPrincipleMaterial(t.db as never, mindId)).eligibility.eligible).toBe(false);
    expect(await (await app.request(`/groups/${groupId}/principles`)).json()).toEqual({ principles: [] });
    await t.sql`UPDATE inspirations SET visibility='public' WHERE profile_id=${other}`;
    // Returning to public advances the source revision. Renew its proof through
    // the real review writer before later cases expect eligible room material.
    const sources = await t.sql`SELECT id FROM inspirations WHERE profile_id = ${other}`;
    for (const source of sources) {
      const report = await reviewSignalSupport(t.db as never, { ownerProfileId: other, inspirationId: source.id as string,
        deriveIntoProfileId: mindId, maxCalls: 1, provider: { assessSignalSupport: async (input) => ({
          assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict: 'supported', sourceIds: [input.sources[0]!.id] })),
        }) } });
      await applySignalSupportReview(t.db as never, report);
    }
  });

  it("undoes only the owner's selected dispute, without changing locked words or model conflicts", async () => {
    const [principle] = await t.sql`SELECT id FROM principles WHERE profile_id=${owner} LIMIT 1`;
    const verdict = await createFeedbackForProfile(t.db as never, {
      profileId: owner, targetType: "principle", targetId: principle.id, value: "not_true",
    });
    expect(verdict).not.toBeNull();
    expect((await loadPrincipleViews(t.db as never, owner))[0]!.disputeId).toBe(verdict!.id);
    expect(await undoPrincipleDispute(t.db as never, other, principle.id, verdict!.id)).toBe(false);
    expect(await undoPrincipleDispute(t.db as never, owner, principle.id, verdict!.id)).toBe(true);
    let [restored] = await t.sql`SELECT statement,state,locked_at FROM principles WHERE id=${principle.id}`;
    expect(restored.state).toBe("held");
    expect(restored.statement).toBe("My own words");
    expect(restored.locked_at).not.toBeNull();
    const [conflict] = await t.sql`INSERT INTO principles(profile_id,statement,rank)
      VALUES (${owner},'A different principle',2) RETURNING id`;
    await t.sql`UPDATE principles SET state='contested',conflicts_with_id=${conflict.id} WHERE id=${principle.id}`;
    const second = await createFeedbackForProfile(t.db as never, {
      profileId: owner, targetType: "principle", targetId: principle.id, value: "not_true",
    });
    await undoPrincipleDispute(t.db as never, owner, principle.id, second!.id);
    [restored] = await t.sql`SELECT state FROM principles WHERE id=${principle.id}`;
    expect(restored.state).toBe("contested");
    expect((await loadPrincipleViews(t.db as never, owner)).find((row) => row.id === principle.id)!.disputeId).toBeNull();
  });

  it("deduplicates completed requests and charges room generation to a member account", async () => {
    await requestPrincipleRefresh(t.db as never, mindId);
    const keyPrefix=`refresh_principles:${mindId}:%`;
    const [job] = await t.sql`SELECT id,profile_id FROM background_jobs WHERE type='refresh_principles' AND idempotency_key LIKE ${keyPrefix}`;
    expect([owner, other]).toContain(job.profile_id);
    await t.sql`UPDATE background_jobs SET status='succeeded' WHERE id=${job.id}`;
    await requestPrincipleRefresh(t.db as never, mindId);
    const rows = await t.sql`SELECT status FROM background_jobs WHERE type='refresh_principles' AND idempotency_key LIKE ${keyPrefix}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("succeeded");
    expect((await loadPrincipleStatus(t.db as never, mindId)).phase).toBe("ready");
    await t.sql`UPDATE background_jobs SET status='failed',attempts=3 WHERE id=${job.id}`;
    await requestPrincipleRefresh(t.db as never, mindId);
    expect((await loadPrincipleStatus(t.db as never, mindId)).phase).toBe("failed");
    await requestPrincipleRefresh(t.db as never, mindId, true);
    expect((await loadPrincipleStatus(t.db as never, mindId)).phase).toBe("processing");
  });
});
