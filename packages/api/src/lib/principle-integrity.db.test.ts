/** WHAT THIS MOCKS, AND WHY (gate G6): `ModelProvider` returns scripted
 * proposals and verdicts to isolate citation/state integrity. Real Postgres,
 * revisions, evidence, projections and publication run without replacement. */
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/index.js';
import {acceptPrincipleGroundingForFixture} from '../../test/helpers/principle-grounding.js';
import {refreshPrinciplesForProfile,promoteIfDemonstrated,reconcilePrinciplesAfterSignalLoss} from './principle-generation.js';
import {loadPrincipleViews} from '../routes/principles.js';
import {createFeedbackForProfile} from '../routes/feedback.js';
import type {ModelProvider} from './model-provider.js';

let t:TestDatabase,n=0;
beforeAll(async()=>{t=await createTestDatabase();});
afterAll(async()=>{await t?.cleanup();});
async function fixture(){
  const [account]=await t.sql`INSERT INTO accounts(email) VALUES(${`principle-integrity-${++n}@example.test`}) RETURNING id`;
  const [profile]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${account.id},'agent','Agent') RETURNING id`;
  const ids:string[]=[];
  for(let i=0;i<3;i++){
    const [signal]=await t.sql`INSERT INTO signals(profile_id,statement) VALUES(${profile.id},${`Distinct choice ${i}`}) RETURNING id`;
    for(let j=0;j<3;j++){
      const [source]=await t.sql`INSERT INTO inspirations(profile_id,text) VALUES(${profile.id},${`Experience ${i} in context ${j}`}) RETURNING id`;
      await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES(${profile.id},${profile.id},${signal.id},${source.id})`;
    }
    await t.sql`UPDATE signals SET status='active' WHERE id=${signal.id}`;
    ids.push(signal.id);
  }
  const [reading]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${profile.id}) RETURNING id`;
  const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${reading.id},'pattern','A current theme') RETURNING id`;
  for(const id of ids)await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES(${entry.id},${id})`;
  return {profileId:profile.id as string,ids};
}
async function principle(f:Awaited<ReturnType<typeof fixture>>,state:'held'|'aspirational'|'contested'='held',human=false){
  const [row]=await t.sql`INSERT INTO principles(profile_id,statement,state,origin,rank,locked_at,held_since)
    VALUES(${f.profileId},'Prefer small reversible trials.',${state},${human?'declared':'minted'},
      (SELECT coalesce(max(rank),0)+1 FROM principles WHERE profile_id=${f.profileId}),
      ${human?new Date().toISOString():null},${state==='aspirational'?null:new Date().toISOString()}) RETURNING id`;
  for(const id of f.ids)await t.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id) VALUES(${f.profileId},${row.id},${id})`;
  return row.id as string;
}
function model(ids:string[]){
  return {name:'integrity-fixture',
    distillPrinciples:vi.fn(async()=>({candidates:[{statement:'Prefer small reversible trials.',type:'maxim',citedSignalIds:ids}]})),
    assessPrincipleGrounding:vi.fn(acceptPrincipleGroundingForFixture),
    judgePrincipleRelation:vi.fn(async(input:Parameters<ModelProvider['judgePrincipleRelation']>[0])=>({relations:input.existingPrinciples.map(row=>({principleId:row.id,relation:'independent' as const}))})),
  };
}

it.each(['foreign','retired'] as const)('rejects a whole proposal with a %s citation instead of salvaging its three valid citations',async(kind)=>{
  const f=await fixture(),other=kind==='foreign'?await fixture():f;
  const [invalid]=kind==='foreign'?[{id:other.ids[0]!}]:await t.sql`INSERT INTO signals(profile_id,statement,status) VALUES(${f.profileId},'Not offered for generation','retired') RETURNING id`;
  const provider=model([...f.ids,invalid.id]);
  const result=await refreshPrinciplesForProfile({profileId:f.profileId},{db:t.db as never,modelProvider:provider as unknown as ModelProvider});
  expect(result).toMatchObject({minted:0,dropped:1});
  expect(provider.assessPrincipleGrounding).not.toHaveBeenCalled();
  expect(await loadPrincipleViews(t.db as never,f.profileId)).toEqual([]);
});

it('does not promote edited owner wording using citations attached to its previous wording',async()=>{
  const f=await fixture(),id=await principle(f,'aspirational',true);
  await t.sql`UPDATE principles SET statement='My new instruction, in my own words.' WHERE id=${id}`;
  expect(await promoteIfDemonstrated(t.db as never,f.profileId,id,new Date())).toBe(false);
  expect((await t.sql`SELECT state,statement FROM principles WHERE id=${id}`)[0]).toMatchObject({state:'aspirational',statement:'My new instruction, in my own words.'});
});

it('reconciles edited owner wording without deleting it or claiming its old support is current',async()=>{
  const f=await fixture(),id=await principle(f,'held',true);
  await t.sql`UPDATE principles SET statement='The owner changed the instruction.' WHERE id=${id}`;
  expect(await reconcilePrinciplesAfterSignalLoss(t.db as never,{profileId:f.profileId,signalIds:f.ids})).toEqual({demoted:[id],removed:[]});
  expect((await loadPrincipleViews(t.db as never,f.profileId))[0]).toMatchObject({statement:'The owner changed the instruction.',state:'aspirational',unsupported:true,locked:true});
});

it('does not retain a machine principle on old signal wording after the source and reading are revalidated',async()=>{
  const f=await fixture(),id=await principle(f);
  await t.sql`UPDATE signals SET statement='A changed pattern' WHERE id=${f.ids[0]!}`;
  await t.sql`UPDATE signal_evidence e SET statement_revision=s.statement_revision FROM signals s WHERE s.id=e.signal_id AND s.id=${f.ids[0]!}`;
  await t.sql`UPDATE top_of_mind_entry_signals c SET statement_revision=s.statement_revision FROM signals s WHERE s.id=c.signal_id AND s.id=${f.ids[0]!}`;
  expect(await reconcilePrinciplesAfterSignalLoss(t.db as never,{profileId:f.profileId,signalIds:f.ids})).toEqual({demoted:[],removed:[id]});
});

it('does not silently discard a withdrawn fourth citation to promote or retain a claim',async()=>{
  const f=await fixture(),aspirational=await principle(f,'aspirational',true),held=await principle(f);
  const [retired]=await t.sql`INSERT INTO signals(profile_id,statement,status) VALUES(${f.profileId},'Withdrawn pattern','retired') RETURNING id`;
  for(const id of [aspirational,held])await t.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id) VALUES(${f.profileId},${id},${retired.id})`;
  expect(await promoteIfDemonstrated(t.db as never,f.profileId,aspirational,new Date())).toBe(false);
  expect(await reconcilePrinciplesAfterSignalLoss(t.db as never,{profileId:f.profileId,signalIds:[retired.id]})).toEqual({demoted:[],removed:[held]});
});

it('counts repeated wording once in eligibility, promotion, reads and support-loss maintenance',async()=>{
  const f=await fixture();
  for(let i=0;i<f.ids.length;i++)await t.sql`UPDATE signals SET statement=${['Same choice','  same   choice  ','ＳＡＭＥ choice'][i]!} WHERE id=${f.ids[i]!}`;
  await t.sql`UPDATE signal_evidence e SET statement_revision=s.statement_revision FROM signals s WHERE s.id=e.signal_id AND s.profile_id=${f.profileId}`;
  await t.sql`UPDATE top_of_mind_entry_signals c SET statement_revision=s.statement_revision FROM signals s WHERE s.id=c.signal_id AND s.profile_id=${f.profileId}`;
  const aspirational=await principle(f,'aspirational',true),held=await principle(f);
  expect((await loadPrincipleViews(t.db as never,f.profileId)).map(row=>row.id)).toEqual([aspirational]);
  expect(await promoteIfDemonstrated(t.db as never,f.profileId,aspirational,new Date())).toBe(false);
  const provider=model(f.ids);
  expect((await refreshPrinciplesForProfile({profileId:f.profileId},{db:t.db as never,modelProvider:provider as unknown as ModelProvider})).status).toBe('below_bar');
  expect(provider.distillPrinciples).not.toHaveBeenCalled();
  expect(await reconcilePrinciplesAfterSignalLoss(t.db as never,{profileId:f.profileId,signalIds:f.ids})).toEqual({demoted:[],removed:[held]});
});

it('restores support only after a fresh grounded match, preserving the owner wording, rank and dispute',async()=>{
  const f=await fixture(),id=await principle(f,'held',true);
  const statement='Try a small reversible version before committing more.';
  await t.sql`UPDATE principles SET statement=${statement},rank=7 WHERE id=${id}`;
  const dispute=await createFeedbackForProfile(t.db as never,{profileId:f.profileId,targetType:'principle',targetId:id,value:'not_true'});
  expect(dispute).not.toBeNull();
  await reconcilePrinciplesAfterSignalLoss(t.db as never,{profileId:f.profileId,signalIds:f.ids});
  expect((await loadPrincipleViews(t.db as never,f.profileId))[0]).toMatchObject({state:'contested',unsupported:true});
  const provider={...model(f.ids),distillPrinciples:async()=>({candidates:[{statement,type:'maxim' as const,citedSignalIds:f.ids}]})};
  const result=await refreshPrinciplesForProfile({profileId:f.profileId},{db:t.db as never,modelProvider:provider as unknown as ModelProvider});
  expect(result).toMatchObject({minted:0,redeemed:1});
  expect((await loadPrincipleViews(t.db as never,f.profileId))[0]).toMatchObject({id,statement,state:'contested',locked:true,rank:7,unsupported:false,supportChanged:false,disputeId:dispute!.id});
});

it('promotes current supported owner words only for the owning profile',async()=>{
  const f=await fixture(),other=await fixture(),id=await principle(f,'aspirational',true);
  expect(await promoteIfDemonstrated(t.db as never,other.profileId,id,new Date())).toBe(false);
  expect((await loadPrincipleViews(t.db as never,f.profileId))[0]?.state).toBe('aspirational');
  expect(await promoteIfDemonstrated(t.db as never,f.profileId,id,new Date())).toBe(true);
  expect((await loadPrincipleViews(t.db as never,f.profileId))[0]).toMatchObject({statement:'Prefer small reversible trials.',state:'held',locked:true});
});
