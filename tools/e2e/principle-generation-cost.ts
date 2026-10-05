/** Large synthetic profile measurement. Scripted model, real SQL; never paid. */
import assert from 'node:assert/strict';
import {createTestDatabase} from '../../packages/api/test/helpers/db.js';
import {refreshPrinciplesForProfile} from '../../packages/api/src/lib/principle-generation.js';
import {buildPrincipleDistillRequest,buildPrincipleRelationRequest} from '../../packages/api/src/queue/gemini.js';
import type {ModelProvider} from '../../packages/api/src/lib/model-provider.js';
import {writeEvaluationSnapshot} from './evaluation-journal.js';
const url=new URL(process.env.DB_CONNECTION_URL??'');
assert.ok(['localhost','127.0.0.1'].includes(url.hostname)&&/test|disposable/i.test(url.pathname));
assert.equal(url.searchParams.has('options'),false);
process.env.NODE_ENV='test';process.env.WAKA_BACKGROUND_JOB_AUTODRAIN='0';
delete process.env.GEMINI_API_KEY;delete process.env.OPENROUTER_API_KEY;
const network=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('Cost fixture forbids provider traffic');};
const t=await createTestDatabase();
try{
  const [a]=await t.sql`INSERT INTO accounts(email) VALUES('principle-cost@example.test') RETURNING id`;
  const [p]=await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Synthetic cost fixture') RETURNING id`;
  await t.sql`INSERT INTO inspirations(profile_id,text) SELECT ${p.id},'Synthetic experience ' || n FROM generate_series(1,3) n`;
  await t.sql`INSERT INTO signals(profile_id,statement) SELECT ${p.id},'A supported synthetic signal ' || n FROM generate_series(1,400) n`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
    SELECT ${p.id},${p.id},s.id,i.id FROM signals s CROSS JOIN inspirations i WHERE s.profile_id=${p.id} AND i.profile_id=${p.id}`;
  await t.sql`UPDATE signals SET status='active' WHERE profile_id=${p.id}`;
  const [reading]=await t.sql`INSERT INTO top_of_minds(profile_id) VALUES(${p.id}) RETURNING id`;
  const [entry]=await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES(${reading.id},'pattern','A current synthetic focus.') RETURNING id`;
  await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) SELECT ${entry.id},id FROM signals WHERE profile_id=${p.id}`;
  await t.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,locked_at)
    SELECT ${p.id},'Standing preference ' || n || '.','maxim','declared',n,now() FROM generate_series(1,200) n`;
  const originalWords=await t.sql`SELECT id,statement,rank,locked_at FROM principles WHERE profile_id=${p.id} AND origin='declared' ORDER BY id`;
  let distillCalls=0,comparisonCalls=0,comparisonPairs=0,maxComparisonBatch=0,maxComparisonCharacters=0,inputSignals=0,inputPrinciples=0,promptCharacters=0,lateConflictChecked=false;
  const provider={
    distillPrinciples:async(input)=>{
      distillCalls++;inputSignals=input.signals.length;inputPrinciples=input.currentPrinciples.length;
      promptCharacters=buildPrincipleDistillRequest(input).contents[0]!.parts[0]!.text.length;
      return {candidates:['Protect open time.','Prefer reversible commitments.','Make room to revise a plan.'].map(statement=>({statement,type:'maxim' as const,citedSignalIds:input.signals.slice(0,3).map(row=>row.id)}))};
    },
    judgePrincipleRelation:async(input)=>{
      comparisonCalls++;
      comparisonPairs+=input.existingPrinciples.length;maxComparisonBatch=Math.max(maxComparisonBatch,input.existingPrinciples.length);
      maxComparisonCharacters=Math.max(maxComparisonCharacters,buildPrincipleRelationRequest(input).contents[0]!.parts[0]!.text.length);
      return {relations:input.existingPrinciples.map(standing=>{
        const conflict=input.candidateStatement==='Protect open time.'&&standing.statement==='Standing preference 200.';
        if(conflict)lateConflictChecked=true;
        return {principleId:standing.id,relation:conflict?'conflicting' as const:'independent' as const};
      })};
    },
  } satisfies Pick<ModelProvider,'distillPrinciples'|'judgePrincipleRelation'>;
  const start=performance.now();
  const result=await refreshPrinciplesForProfile({profileId:p.id},{db:t.db as never,modelProvider:provider as ModelProvider});
  const words=await t.sql`SELECT id,statement,rank,locked_at FROM principles WHERE profile_id=${p.id} AND origin='declared' ORDER BY id`;
  const humanWordsPreserved=JSON.stringify(words)===JSON.stringify(originalWords);
  const report={profileSignals:400,standingPrinciples:200,inputSignals,inputPrinciples,promptCharacters,distillCalls,comparisonCalls,comparisonPairs,maxComparisonBatch,maxComparisonCharacters,
    totalModelCalls:distillCalls+comparisonCalls,lateConflictChecked,humanWordsPreserved,durationMs:Math.round(performance.now()-start),result,paidCalls:0};
  const path=`work/principle-cost/run-${Date.now()}.json`;writeEvaluationSnapshot(path,report);console.log(JSON.stringify({path,...report}));
  assert.ok(lateConflictChecked);assert.ok(humanWordsPreserved);assert.equal(words.length,200);
}finally{globalThis.fetch=network;await t.cleanup();}
