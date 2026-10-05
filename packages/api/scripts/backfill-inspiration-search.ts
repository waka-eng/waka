/** Explicit search-only maintenance. No dotenv, source wording in output or model calls. */
import {parseArgs} from 'node:util';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
import * as schema from '../src/db/index.js';
import {backfillInspirationTextSearch,INSPIRATION_TEXT_SEARCH_POLICY} from '../src/lib/inspiration-search.js';
const {values}=parseArgs({options:{apply:{type:'boolean'},stage:{type:'string'},'expected-host':{type:'string'},schema:{type:'string'},'profile-id':{type:'string'},'batch-size':{type:'string'},'max-batches':{type:'string'},help:{type:'boolean'}}});
if(values.help){
  console.log('backfill-inspiration-search [--apply --stage local|dev --expected-host <host>] [--schema <schema>] [--profile-id <uuid>] [--batch-size 250] [--max-batches 1]\nRequires explicit DB_CONNECTION_URL. Defaults to counts only. Apply commits bounded search-metadata batches; rerun to resume. Production is excluded. Verify the actual dev URL independently before use. No env file or provider is used; source wording stays in Postgres and is not logged.');
}else{
  let client:ReturnType<typeof postgres>|undefined;
  try{
    if(!process.env.DB_CONNECTION_URL)throw new Error('Set DB_CONNECTION_URL explicitly');
    const url=new URL(process.env.DB_CONNECTION_URL),loopback=['127.0.0.1','localhost','::1'].includes(url.hostname);
    const batchSize=Number(values['batch-size']??250),maxBatches=Number(values['max-batches']??1);
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>1000||!Number.isInteger(maxBatches)||maxBatches<1||maxBatches>100)throw new Error('Invalid bounded batch settings');
    if(values['profile-id']!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(values['profile-id']))throw new Error('Invalid profile');
    if(values.schema!==undefined&&!/^[a-z_][a-z0-9_]{0,62}$/.test(values.schema))throw new Error('Invalid schema');
    if(values.apply){
      if(!['local','dev'].includes(values.stage??'')||values['expected-host']!==url.hostname)throw new Error('Apply requires stage local/dev and the exact expected host');
      if(values.stage==='local'&&(!loopback||!/(?:^|[_/\-])(test|disposable)(?:$|[_\-])/i.test(url.pathname)))throw new Error('Local apply requires a disposable loopback database');
      if(values.stage==='dev'&&loopback)throw new Error('Use local for a loopback rehearsal');
    }
    if(values.schema)url.searchParams.set('options',`-c search_path=${values.schema}`);
    client=postgres(url.toString(),{max:1,prepare:false,ssl:loopback?false:'require'});
    const db=drizzle(client,{schema}),profileId=values['profile-id'];
    const remaining=async()=>{
      const rows=profileId?await client!`SELECT count(*)::int AS count FROM inspirations WHERE profile_id=${profileId} AND (text_search_vector IS NULL OR text_search_vector_policy IS DISTINCT FROM ${INSPIRATION_TEXT_SEARCH_POLICY})`
        :await client!`SELECT count(*)::int AS count FROM inspirations WHERE text_search_vector IS NULL OR text_search_vector_policy IS DISTINCT FROM ${INSPIRATION_TEXT_SEARCH_POLICY}`;
      return Number(rows[0].count);
    };
    console.log(JSON.stringify({mode:values.apply?'apply':'dry-run',host:url.hostname,remaining:await remaining()}));
    if(values.apply)for(let n=0;n<maxBatches;n++){
      const result=await backfillInspirationTextSearch(db,{limit:batchSize,profileId});
      console.log(JSON.stringify({batch:n+1,...result}));if(!result.updated)break;
    }
    console.log(JSON.stringify({remaining:await remaining(),resumable:true}));
  }catch{
    console.error('Search backfill stopped. Check explicit target/stage and bounded arguments. Confirm committed progress before rerunning; completed batches are safe to resume.');process.exitCode=1;
  }finally{await client?.end();}
}
