/** Real SQL proves principle history, privacy and queue identity. Only the model is scripted. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {randomUUID,createHash} from 'node:crypto';
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { loadPrincipleViews, renderPrinciplesMarkdown, undoPrincipleDispute } from "../routes/principles.js";
import { createFeedbackForProfile } from "../routes/feedback.js";
import { loadPrincipleMaterial, promoteIfDemonstrated, refreshPrinciplesForProfile, reconcilePrinciplesAfterSignalLoss } from "./principle-generation.js";
import { requestPrincipleRefresh, loadPrincipleStatus } from "./principle-status.js";
import {principleMaterialKey} from './principle-material-key.js';
import type { ModelProvider } from "./model-provider.js";
import {createReviewSession} from './review-sessions.js';
import {loadReviewAnswerMaterial} from './review-answer-material.js';
import {writeReviewEvidence} from './review-evidence.js';
import {BackgroundJobHeldError} from './background-job-hold.js';
import {postgresBackgroundJobStore,processBackgroundJob} from './queue.js';
import {getDb} from './db.js';
import {setDefaultModelProviderForTests} from './model-provider.js';
import {acceptPrincipleGroundingForFixture} from '../../test/helpers/principle-grounding.js';

let t: TestDatabase;
let owner: string;
let other: string;
let sequence = 0;

async function person() {
  const [a] = await t.sql`INSERT INTO accounts(email) VALUES (${`principle-flow-${sequence++}@example.test`}) RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${a.id},'human','Test') RETURNING id`;
  return p.id as string;
}

/* `targetGroupId` and the `owners` fan-out went with the rooms (founder:
   "방 없애"). They let this helper aim three signals at a room's mind and
   spread their evidence over two members; the `input_policy` and
   `top_of_minds(group_id)` branches existed only for that. `owners` stays a
   list because the personal cases still pass a single-entry one and the
   shape reads the same at every call site. */
async function material(profileId: string, owners: string[]) {
  const ids: string[] = [];
  for (let n = 0; n < 3; n++) {
    const [s] = await t.sql`INSERT INTO signals(profile_id,statement)
      VALUES (${profileId},${`Pattern ${n}`}) RETURNING id`;
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
  const [tom] = await t.sql`INSERT INTO top_of_minds(profile_id) VALUES (${profileId}) RETURNING id`;
  const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body)
    VALUES (${tom.id},'pattern','A present focus') RETURNING id`;
  for (const id of ids) await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES (${entry.id},${id})`;
  return ids;
}

const provider = {
  assessPrincipleGrounding:acceptPrincipleGroundingForFixture,
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
});
afterAll(async () => { await getDb().$client.end();await t?.cleanup(); });

describe("principles across personal profiles", () => {
  it('resumes through the real queue without resetting paid-step receipts',async()=>{
    const profileId=await person(),ids=await material(profileId,[profileId]);
    await t.sql`INSERT INTO principles(profile_id,statement,origin,rank,locked_at) SELECT ${profileId},'Standing ' || n,'declared',n,now() FROM generate_series(1,80) n`;
    let distills=0,comparisons=0;
    setDefaultModelProviderForTests({name:'queue-fixture',assessPrincipleGrounding:acceptPrincipleGroundingForFixture,distillPrinciples:async()=>{distills++;return {candidates:[{statement:'A queued directive.',type:'maxim',citedSignalIds:ids}]};},
      judgePrincipleRelation:async(input:Parameters<ModelProvider['judgePrincipleRelation']>[0])=>{comparisons++;return {relations:input.existingPrinciples.map(row=>({principleId:row.id,relation:'independent'}))};}} as unknown as ModelProvider);
    try{
      await requestPrincipleRefresh(t.db as never,profileId);
      await t.sql`UPDATE background_jobs SET run_after=now()+interval '1 day' WHERE type<>'refresh_principles' OR profile_id<>${profileId}`;
      const first=await postgresBackgroundJobStore.claimNext(new Date());expect(first).not.toBeNull();
      let held:BackgroundJobHeldError|undefined;
      try{await processBackgroundJob(first!);}catch(error){expect(error).toBeInstanceOf(BackgroundJobHeldError);held=error as BackgroundJobHeldError;}
      expect(held).toBeDefined();await postgresBackgroundJobStore.holdJob(first!,held!.heldUntil,'support');
      const [receipt]=await t.sql`SELECT count(*)::int AS count FROM principle_generation_steps WHERE profile_id=${profileId} AND kind='model'`;
      expect(receipt.count).toBe(4);
      expect((await t.sql`SELECT status FROM background_jobs WHERE id=${first!.id}`)[0].status).toBe('pending');
      await t.sql`UPDATE background_jobs SET run_after=now()-interval '1 second' WHERE id=${first!.id}`;
      const second=await postgresBackgroundJobStore.claimNext(new Date());expect(second?.id).toBe(first!.id);
      await processBackgroundJob(second!);await postgresBackgroundJobStore.markSucceeded(second!,null);
      expect(distills).toBe(1);expect(comparisons).toBe(4);
      expect((await loadPrincipleStatus(t.db as never,profileId)).phase).toBe('ready');
    }finally{setDefaultModelProviderForTests(null);}
  });
  it('resumes all comparisons across an unchanged reading without another distillation',async()=>{
    const profileId=await person(),ids=await material(profileId,[profileId]);
    await t.sql`INSERT INTO principles(profile_id,statement,origin,rank,locked_at) SELECT ${profileId},'Standing ' || n,'declared',n,now() FROM generate_series(1,80) n`;
    let distills=0,comparisons=0,groundings=0;
    const model={assessPrincipleGrounding:async(input:Parameters<ModelProvider['assessPrincipleGrounding']>[0])=>{groundings++;return acceptPrincipleGroundingForFixture(input);},distillPrinciples:async()=>{distills++;return {candidates:[{statement:'A new directive.',type:'maxim',citedSignalIds:ids}]};},
      judgePrincipleRelation:async(input:Parameters<ModelProvider['judgePrincipleRelation']>[0])=>{comparisons++;return {relations:input.existingPrinciples.map(row=>({principleId:row.id,relation:'independent'}))};}} as unknown as ModelProvider;
    await expect(refreshPrinciplesForProfile({profileId},{db:t.db as never,modelProvider:model})).rejects.toBeInstanceOf(BackgroundJobHeldError);
    expect(distills).toBe(1);expect(comparisons).toBe(2);expect(groundings).toBe(1);
    expect(await t.sql`SELECT id FROM principles WHERE profile_id=${profileId} AND origin='minted'`).toHaveLength(0);
    await t.sql`UPDATE top_of_minds SET status='superseded' WHERE profile_id=${profileId}`;
    const [tom]=await t.sql`INSERT INTO top_of_minds(profile_id,version,reason) VALUES(${profileId},2,'no_change') RETURNING id`;
    const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${tom.id},'pattern','A present focus') RETURNING id`;
    for(const id of ids)await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES(${entry.id},${id})`;
    expect((await refreshPrinciplesForProfile({profileId},{db:t.db as never,modelProvider:model})).minted).toBe(1);
    expect(distills).toBe(1);expect(comparisons).toBe(4);expect(groundings).toBe(1);
  });

  it('rejects an unsupported candidate and retries an incomplete grounding verdict without re-distilling',async()=>{
    const profileId=await person(),ids=await material(profileId,[profileId]);let distills=0,checks=0;
    const model={...provider,distillPrinciples:async()=>{distills++;return {candidates:[{statement:'An added unsupported trade-off.',type:'maxim',citedSignalIds:ids}]};},
      assessPrincipleGrounding:async(input:Parameters<ModelProvider['assessPrincipleGrounding']>[0])=>{checks++;return {assessments:checks===1?[]:input.candidates.map(row=>({candidateId:row.id,supported:false}))};}} as ModelProvider;
    await expect(refreshPrinciplesForProfile({profileId},{db:t.db as never,modelProvider:model})).rejects.toThrow(/incomplete principle grounding/);
    expect(await t.sql`SELECT id FROM principles WHERE profile_id=${profileId}`).toHaveLength(0);
    const result=await refreshPrinciplesForProfile({profileId},{db:t.db as never,modelProvider:model});
    expect(result).toMatchObject({minted:0,dropped:1});expect(distills).toBe(1);expect(checks).toBe(2);
  });
  it('refuses publication when sources change during grounding',async()=>{
    const profileId=await person();await material(profileId,[profileId]);
    const model={...provider,assessPrincipleGrounding:async(input:Parameters<ModelProvider['assessPrincipleGrounding']>[0])=>{
      await t.sql`UPDATE inspirations SET text='Corrected current words' WHERE profile_id=${profileId}`;
      return acceptPrincipleGroundingForFixture(input);
    }} as ModelProvider;
    await expect(refreshPrinciplesForProfile({profileId},{db:t.db as never,modelProvider:model})).rejects.toThrow(/inputs changed/);
    expect(await t.sql`SELECT id FROM principles WHERE profile_id=${profileId}`).toHaveLength(0);
  });
  it('recovers a committed publication without restoring words edited afterward',async()=>{
    const profileId=await person(),ids=await material(profileId,[profileId]);
    await requestPrincipleRefresh(t.db as never,profileId);
    const [job]=await t.sql`SELECT id FROM background_jobs WHERE profile_id=${profileId} AND type='refresh_principles'`;
    let calls=0;
    const model={assessPrincipleGrounding:acceptPrincipleGroundingForFixture,distillPrinciples:async()=>{calls++;return {candidates:[{statement:'Initial generated words.',type:'maxim',citedSignalIds:ids}]};}} as unknown as ModelProvider;
    const options={db:t.db as never,modelProvider:model,jobId:job.id as string};
    const result=await refreshPrinciplesForProfile({profileId},options);expect(result.minted).toBe(1);
    await t.sql`UPDATE principles SET statement='The exact words I chose.',locked_at=now() WHERE profile_id=${profileId}`;
    expect(await refreshPrinciplesForProfile({profileId},options)).toEqual(result);expect(calls).toBe(1);
    expect((await t.sql`SELECT statement FROM principles WHERE profile_id=${profileId}`)[0].statement).toBe('The exact words I chose.');
  });
  it('invalidates paused comparisons after a human edits standing wording',async()=>{
    const profileId=await person(),ids=await material(profileId,[profileId]);
    await t.sql`INSERT INTO principles(profile_id,statement,origin,rank,locked_at) SELECT ${profileId},'Standing ' || n,'declared',n,now() FROM generate_series(1,80) n`;
    let distills=0,sawEdit=false;
    const model={assessPrincipleGrounding:acceptPrincipleGroundingForFixture,distillPrinciples:async()=>{distills++;return {candidates:[{statement:'A new directive.',type:'maxim',citedSignalIds:ids}]};},
      judgePrincipleRelation:async(input:Parameters<ModelProvider['judgePrincipleRelation']>[0])=>({relations:input.existingPrinciples.map(row=>{
        const edited=row.statement==='My edited human wording.';sawEdit ||= edited;
        return {principleId:row.id,relation:edited?'conflicting':'independent'};
      })})} as unknown as ModelProvider;
    await expect(refreshPrinciplesForProfile({profileId},{db:t.db as never,modelProvider:model})).rejects.toBeInstanceOf(BackgroundJobHeldError);
    await t.sql`UPDATE principles SET statement='My edited human wording.' WHERE profile_id=${profileId} AND rank=79`;
    await expect(refreshPrinciplesForProfile({profileId},{db:t.db as never,modelProvider:model})).rejects.toBeInstanceOf(BackgroundJobHeldError);
    const result=await refreshPrinciplesForProfile({profileId},{db:t.db as never,modelProvider:model});
    expect(distills).toBe(2);expect(sawEdit).toBe(true);expect(result.conflicts).toBe(1);
    expect((await t.sql`SELECT statement FROM principles WHERE profile_id=${profileId} AND rank=79`)[0].statement).toBe('My edited human wording.');
  });
  it('does not spend model calls on a superseded queued material key',async()=>{
    const profileId=await person();await material(profileId,[profileId]);
    const result=await refreshPrinciplesForProfile({profileId},{db:t.db as never,expectedMaterialKey:'obsolete',modelProvider:{distillPrinciples:async()=>{throw new Error('Must not dispatch');}} as unknown as ModelProvider});
    expect(result.status).toBe('superseded');
  });
  it('allows one explicit/scheduled pass after a policy change, while GET remains read-only and new requests deduplicate',async()=>{
    const profileId=await person();await material(profileId,[profileId]);
    const current=await loadPrincipleMaterial(t.db as never,profileId);
    const oldKey=createHash('sha256').update(JSON.stringify({policy:'principles-v3',groupId:current.groupId,locale:current.preferredLocale,
      signals:current.activeSignals.map(row=>({id:row.id,statement:row.statement,evidence:current.evidence.get(row.id)?.evidenceAt.map(at=>at.toISOString()).sort(),supportKey:current.evidence.get(row.id)?.supportKey,versions:current.evidence.get(row.id)?.tomVersionIds.slice().sort()})).sort((a,b)=>a.id.localeCompare(b.id))})).digest('hex');
    expect(principleMaterialKey(current)).not.toBe(oldKey);
    await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status,idempotency_key) VALUES(${profileId},'refresh_principles',${JSON.stringify({profileId})}::jsonb,'succeeded',${`refresh_principles:${profileId}:${oldKey}`})`;
    await loadPrincipleStatus(t.db as never,profileId);
    expect(await t.sql`SELECT id FROM background_jobs WHERE profile_id=${profileId} AND type='refresh_principles'`).toHaveLength(1);
    await requestPrincipleRefresh(t.db as never,profileId);await requestPrincipleRefresh(t.db as never,profileId);
    const jobs=await t.sql`SELECT status FROM background_jobs WHERE profile_id=${profileId} AND type='refresh_principles'`;
    expect(jobs).toHaveLength(2);expect(jobs.filter(row=>row.status==='pending')).toHaveLength(1);
  });
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

  it('does not count duplicate wording under different IDs as distinct patterns',async()=>{
    const profileId=await person(),ids=await material(profileId,[profileId]);
    await t.sql`UPDATE signals SET statement='The same repeated wording.' WHERE id IN ${t.sql(ids)}`;
    await t.sql`UPDATE signal_evidence e SET statement_revision=s.statement_revision FROM signals s WHERE s.id=e.signal_id AND s.profile_id=${profileId}`;
    await t.sql`UPDATE top_of_mind_entry_signals c SET statement_revision=s.statement_revision FROM signals s WHERE s.id=c.signal_id AND s.profile_id=${profileId}`;
    const result=await refreshPrinciplesForProfile({profileId},{db:t.db as never,modelProvider:provider});
    expect(result.minted).toBe(0);expect(result.dropped).toBe(1);
    expect(await t.sql`SELECT id FROM principles WHERE profile_id=${profileId}`).toHaveLength(0);
  });

  /* ── "USES ROOM HISTORY, SERVES ONLY ROOM SIGNAL STATEMENTS AND
     WITHDRAWS UNSUPPORTED ROOM PRINCIPLES", DELETED ─────────────────────
     Founder: "방 없애". This was the only test in the repo that drove
     `GET /groups/:id/principles` end to end, and it was three gates in one:
     a room's principles are eligible on the ROOM's top-of-mind history, the
     response carries statements but never the members' raw captures
     ("PRIVATE RAW TEXT MUST NEVER LEAVE"), and one member turning their
     memories private withdraws the room's principles on the next read.

     THE PRIVACY HALF IS NOT LOST, and that is the part worth arguing. It
     only ever mattered because a room let OTHER PEOPLE read a surface built
     from your captures. With the room gone the reader and the owner are the
     same person, and a personal principle serving its owner's own statements
     is covered elsewhere in this suite.

     CORRECTION (2026-10-15), in two steps, because the first was also wrong.
     The note originally claimed coverage by a test called "serves no
     principle whose material a reader may not see". NO SUCH TEST EXISTED —
     the name was a promise, not a reference, and the fixture's "PRIVATE RAW
     TEXT MUST NEVER LEAVE" string had nothing reading it back. So I wrote
     one. IT FAILED, and it deserved to: a personal principle view
     DELIBERATELY carries the owner's own captures as
     `citedSignals[].examples[].text`, scoped by `i.profile_id = profileId`
     in `loadPrincipleViews`. The owner reading their own words is the
     feature, not a leak.

     SO THE PRIVACY HALF HAS NO PERSONAL ANALOGUE, and claiming otherwise was
     the error in both directions. The deleted assertion was about OTHER
     PEOPLE reading a surface built from your captures — a property that
     needs two members to even be stated. There are no longer two members, so
     it goes with the cross-member case rather than being reworded into a
     personal one that would have to assert the opposite of the design.

     WHAT STILL GUARDS IT if rooms ever return: the scoping predicate itself,
     `i.profile_id = profileId`. That is the line to write a test against on
     the day a second reader exists. The fixture keeps the shouty string so
     the next person has the trap ready to arm.

     The trailing block that renewed `other`'s support through the real
     `reviewSignalSupport` / `applySignalSupportReview` writers went with it:
     its whole purpose was to leave eligible ROOM material for the case
     after it, and that case is gone too. */

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

  /* ── "DEDUPLICATES COMPLETED REQUESTS AND CHARGES ROOM GENERATION TO A
     MEMBER ACCOUNT", DELETED ────────────────────────────────────────────
     Founder: "방 없애". Two things were pinned here and they part ways.

     The BILLING half — a room's mind has no account, so its principle job is
     charged to a current member, "expect([owner, other]).toContain(...)" —
     describes `enqueueRefreshPrinciples`'s room branch, which is being
     removed. There is nothing left to charge to somebody else.

     The DEDUPLICATION half — a completed `refresh_principles` key stays
     completed, a failed one reports failed, and an explicit retry moves it
     to processing — is NOT room-specific and is NOT being dropped: it is
     held for a personal profile by "resumes through the real queue without
     resetting paid-step receipts" at the top of this file and by
     `queue-recovery` / `job-request-version`. Rewriting this one with a
     person substituted for the mind would have duplicated that, while
     quietly losing the only thing it uniquely said. */
  /* A READING THAT FAILED IS A STATE THE PAGES CAN SHOW. Out of credit (402)
     fails the reading job after its retries; before `readingPaused` the
     status endpoint had no way to say so and the person saw nothing at all.
     Latest-wins is the half worth pinning: a failure a later success
     repaired must not keep the notice up. */
  it('reports a failed reading as paused, and a retry restarts it', async () => {
    const profileId = await person();
    expect((await loadPrincipleStatus(t.db as never, profileId)).readingPaused).toBe(false);
    await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status,last_error,updated_at)
      VALUES(${profileId},'refresh_top_of_mind',${JSON.stringify({ reason: 'manual' })}::jsonb,'failed','OpenRouter 402',now()-interval '1 minute')`;
    expect((await loadPrincipleStatus(t.db as never, profileId)).readingPaused).toBe(true);
    const after = await requestPrincipleRefresh(t.db as never, profileId, true);
    expect(after.readingPaused).toBe(false);
    const jobs = await t.sql`SELECT status FROM background_jobs WHERE profile_id=${profileId} AND type='refresh_top_of_mind' ORDER BY updated_at`;
    expect(jobs.map((row) => row.status)).toEqual(['failed', 'pending']);
    /* a plain refresh (no retry) never buys a reading on its own */
    const quiet = await person();
    await t.sql`INSERT INTO background_jobs(profile_id,type,payload,status) VALUES(${quiet},'refresh_top_of_mind',${JSON.stringify({ reason: 'manual' })}::jsonb,'failed')`;
    await requestPrincipleRefresh(t.db as never, quiet);
    expect(await t.sql`SELECT id FROM background_jobs WHERE profile_id=${quiet} AND type='refresh_top_of_mind'`).toHaveLength(1);
    /* and a later success clears it */
    await t.sql`UPDATE background_jobs SET status='succeeded', updated_at=now() WHERE profile_id=${profileId} AND status='pending'`;
    expect((await loadPrincipleStatus(t.db as never, profileId)).readingPaused).toBe(false);
  });
});
