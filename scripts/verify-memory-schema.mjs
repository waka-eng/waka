/** Read-only rollout check. Never prints a URL, credentials or memory rows. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import postgres from 'postgres';

assert.ok(process.env.DB_CONNECTION_URL,'DB_CONNECTION_URL is required');
const db=postgres(process.env.DB_CONNECTION_URL,{max:1,connect_timeout:10});
try{
  const columns=await db`SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('conversation_reply_requests','principle_generation_steps','inspirations')`;
  const names=new Set(columns.map(row=>`${row.table_name}.${row.column_name}`));
  const required=['conversation_reply_requests.retrieval_dispatched_at','conversation_reply_requests.context_sources',
    'inspirations.text_search_vector','inspirations.text_search_vector_policy',
    ...['id','profile_id','billing_profile_id','job_id','input_hash','step_key','kind','status','response','started_at','finished_at'].map(name=>`principle_generation_steps.${name}`)];
  const missing=required.filter(name=>!names.has(name));assert.equal(missing.length,0,`Missing schema fields: ${missing.join(', ')}`);
  const indexes=new Set((await db`SELECT indexname FROM pg_indexes WHERE schemaname='public'`).map(row=>row.indexname));
  for(const name of ['inspiration_embeddings_profile_scope_recent_idx','principle_generation_steps_lookup','principle_generation_steps_budget','principle_generation_steps_job'])assert.ok(indexes.has(name),`Missing index: ${name}`);
  const constraints=await db`SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('public.conversation_reply_requests'::regclass,'public.principle_generation_steps'::regclass)`;
  assert.ok(constraints.some(row=>row.conname==='conversation_context_sources_bounds'),'Missing selected-context bound');
  const job=constraints.find(row=>row.conname==='principle_generation_steps_job_fk')?.definition??'';
  assert.ok(job.includes('(billing_profile_id, job_id)')&&job.includes('(profile_id, id)')&&job.includes('ON DELETE CASCADE'),'Missing owner-bearing job reference');
  const triggers=await db`SELECT t.tgname,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t
    WHERE t.tgrelid='public.inspirations'::regclass AND NOT t.tgisinternal`;
  assert.ok(triggers.some(row=>row.tgname==='inspirations_text_search'&&row.definition.includes('BEFORE INSERT OR UPDATE OF text')),'Missing synchronous text-search trigger');
  const generation=triggers.find(row=>row.tgname==='inspirations_generation_revision')?.definition??'';
  assert.ok(generation.includes('text_search_vector')&&generation.includes('text_search_vector_policy'),'Search metadata must be excluded from source generation fencing');
  for(const file of ['0065_conversation_retrieval.sql','0066_principle_generation_steps.sql','0067_inspiration_text_search.sql']){
    const hash=createHash('sha256').update(readFileSync(new URL(`../drizzle/migrations/${file}`,import.meta.url))).digest('hex');
    assert.equal((await db`SELECT hash FROM drizzle.__drizzle_migrations WHERE hash=${hash}`).length,1,`Missing migration receipt: ${file}`);
  }
  console.log('Memory schema verified: migrations 0065/0066/0067, columns, indexes, bounds, owner-bearing FK and search triggers.');
}catch(error){
  console.error(error instanceof assert.AssertionError?error.message:`Memory schema verification failed (${error?.code??'unavailable'}).`);
  process.exitCode=1;
}finally{await db.end();}
