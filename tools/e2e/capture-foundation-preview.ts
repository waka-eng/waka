/** Real auth/Hono/SQL browser fixture for C01/C02. Object storage is an in-memory
 * S3 transport; microphone input is an explicitly synthetic WebAudio tone.
 * Browser MediaRecorder/IndexedDB and the shipped composer remain real.
 * This is not evidence of physical microphones, mobile devices or AWS policy. */
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createTestDatabase } from '../../packages/api/test/helpers/db.js';

const url = new URL(process.env.DB_CONNECTION_URL ?? '');
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname)); assert.match(url.pathname, /test|disposable/i);
assert.equal(url.searchParams.has('options'), false);
process.env.NODE_ENV = 'test'; process.env.JWT_SECRET = 'capture-foundation-fixture-secret';
process.env.WAKA_BACKGROUND_JOB_AUTODRAIN = '0';
delete process.env.GEMINI_API_KEY; delete process.env.OPENROUTER_API_KEY;
delete process.env.WAKA_BACKGROUND_WORKER_FUNCTION; delete process.env.AWS_LAMBDA_FUNCTION_NAME;
const origin = 'http://127.0.0.1:3015';
process.env.ATTACHMENTS_BUCKET = 'capture-fixture'; process.env.ATTACHMENTS_ENDPOINT = origin;
const network = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (target.origin !== origin) return Promise.reject(new Error('Fixture forbids external provider requests'));
  return network(input, init);
};
const fixture = await createTestDatabase();
url.searchParams.set('options', `-c search_path=${fixture.schemaName}`); process.env.DB_CONNECTION_URL = url.toString();
const { app } = await import('../../packages/api/src/index.js');
const { signSessionToken, buildSessionCookie } = await import('../../packages/api/src/lib/auth.js');
const { createSessionRow } = await import('../../packages/api/src/lib/session.js');
const { getDb } = await import('../../packages/api/src/lib/db.js');
let reflectionCalls = 0, reviewCalls = 0, conversationCalls=0,failConversationReply=false,holdConversationReply=false;
let releaseConversationReply:(()=>void)|null=null,runningConversationReply:Promise<unknown>|null=null;
if(process.env.WAKA_CONVERSATION_FIXTURE==='1')process.env.WAKA_CONVERSATION_REPLIES='1';
if (process.env.WAKA_REFLECTION_FIXTURE === '1' || process.env.WAKA_REVIEW_FIXTURE === '1' || process.env.WAKA_CONVERSATION_FIXTURE==='1') {
  const { setDefaultModelProviderForTests } = await import('../../packages/api/src/lib/model-provider.js');
  const provider: import('../../packages/api/src/lib/model-provider.js').ModelProvider = {
    name: 'synthetic-reflection-fixture',
    answerConversation:async input=>{
      conversationCalls++;
      if(holdConversationReply)await new Promise<void>(resolve=>{releaseConversationReply=resolve;});
      if(failConversationReply){failConversationReply=false;throw new Error('Synthetic reply failure');}
      const questions=['What condition would help you think through this?','How could you test that within your current constraints?','What would you want to notice after trying it?'];
      return {answer:input.sources.length?'The saved wording can be a starting point, not a decision about you.':'We can start with the choice in front of you.',
        followUpQuestion:questions[Math.min(input.history.filter(row=>row.role==='assistant').length,questions.length-1)],
        citations:input.sources.length?[{sourceNumber:1,quote:input.sources[0].text.slice(0,80)}]:[]};
    },
    askReflectionQuestion: async () => { reflectionCalls += 1; return {question: 'What would a small first step make possible for you?'}; },
    askReviewQuestion: async input => {reviewCalls+=1;return input.history.length
      ?{connection:null,question:'What would protecting that open space look like in your next week?',sourceNumbers:[1]}
      :{connection:input.sources.length>1?'These both leave space for an idea before deciding what it becomes.':null,
        question:'Where would a little more room for the unplanned matter to you?',sourceNumbers:input.sources.length>1?[1,2]:[1]};},
    extractSignalCandidates: async () => { throw new Error('Only reflection questions are enabled in this fixture'); },
  } as import('../../packages/api/src/lib/model-provider.js').ModelProvider;
  setDefaultModelProviderForTests(provider);
}
const [account] = await fixture.sql`INSERT INTO accounts(email,onboarding_completed_at) VALUES ('capture-fixture@example.test',now()) RETURNING id`;
const [profile] = await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Capture fixture') RETURNING id`;
await fixture.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'A little room to think.')`;
if(process.env.WAKA_REVIEW_FIXTURE==='1'){
  await fixture.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'A walk without a destination helped me notice a new idea.'),(${profile.id},'I want my mornings to have fewer planned tasks.')`;
}
const token = await signSessionToken({ profileId: profile.id, email: 'capture-fixture@example.test' });
await createSessionRow({ profileId: profile.id, token });
let reviewEvidenceFixture: {sessionId:string;answerId:string;signalId:string;principleId:string}|null=null;
let reviewResultFixture:{sessionId:string;answerId:string;topOfMindId:string}|null=null;
if(process.env.WAKA_REVIEW_EVIDENCE_FIXTURE==='1'||process.env.WAKA_REVIEW_RESULT_FIXTURE==='1'||process.env.WAKA_SHARE_FIXTURE==='1'){
  try {
  const {createReviewSession}=await import('../../packages/api/src/lib/review-sessions.js');
  const {loadReviewAnswerMaterial}=await import('../../packages/api/src/lib/review-answer-material.js');
  const {writeReviewEvidence}=await import('../../packages/api/src/lib/review-evidence.js');
  const [source]=await fixture.sql`SELECT id FROM inspirations WHERE profile_id=${profile.id} ORDER BY created_at LIMIT 1`;
  const session=(await createReviewSession(fixture.db as never,profile.id,{id:crypto.randomUUID(),inspirationIds:[source.id]}))!;
  const answerId=crypto.randomUUID();
  await fixture.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,question,answer,source_count)
    VALUES(${answerId},${profile.id},${session.id},${crypto.randomUUID()},'fixture','fixture','Where would more room matter?','I want to leave one morning open each week. I do not want every idea to become another task.',1)`;
  await fixture.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced)
    VALUES(${profile.id},${session.id},${answerId},${source.id},1,true)`;
  const [signal]=await fixture.sql`INSERT INTO signals(profile_id,statement) VALUES(${profile.id},'I want room for ideas without turning each one into a task.') RETURNING id`;
  const material=(await loadReviewAnswerMaterial(fixture.db as never,profile.id,answerId))!;
  await fixture.db.transaction(tx=>writeReviewEvidence(tx as never,material,signal.id));
  const [principle]=await fixture.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,locked_at)
    VALUES(${profile.id},'Leave room for an idea before deciding what it should become.','maxim','declared',0,now()) RETURNING id`;
  await fixture.sql`INSERT INTO principle_signals(profile_id,principle_id,signal_id,statement_revision,principle_statement_revision)
    VALUES(${profile.id},${principle.id},${signal.id},1,1)`;
  const [reading]=await fixture.sql`INSERT INTO top_of_minds(profile_id) VALUES(${profile.id}) RETURNING id`;
  const [entry]=await fixture.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,sort_order)
    VALUES(${reading.id},'pattern','Making room for ideas without turning each one into a task.',0) RETURNING id`;
  await fixture.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id,statement_revision,entry_body_revision) VALUES(${entry.id},${signal.id},1,1)`;
  reviewEvidenceFixture={sessionId:session.id,answerId,signalId:signal.id,principleId:principle.id};
  if(process.env.WAKA_SHARE_FIXTURE==='1'){
    await fixture.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,locked_at) VALUES
      (${profile.id},'작게 시작하고, 배운 것을 다음 선택에 반영한다.','maxim','declared',1,now()),
      (${profile.id},'Protect time for the people who matter.','value','declared',2,now())`;
    // Real edits create the chain used by the change-card UI. No invented
    // history fallback is installed in application code.
    for(const statement of ['Finish every idea before starting another.','Leave room for an idea before deciding what it should become.']){
      const response=await app.fetch(new Request(`${origin}/api/principles/${principle.id}`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({statement})}));
      assert.equal(response.status,200);
    }
  }
  if(process.env.WAKA_REVIEW_RESULT_FIXTURE==='1'){
    const {enqueueTopOfMindRefresh}=await import('../../packages/api/src/lib/queue.js');
    const {readReviewSession,chooseReviewItem,completeReviewSession}=await import('../../packages/api/src/lib/review-sessions.js');
    const readingJob=await enqueueTopOfMindRefresh(profile.id,'signals_changed',fixture.db as never);
    const [derivation]=await fixture.sql`SELECT id,request_version::text FROM background_jobs WHERE profile_id=${profile.id} AND type='derive_review_answer'`;
    // Scripted stage completion for UI timing tests; the queue SQL suite
    // separately proves real producer/publication execution.
    await fixture.sql`INSERT INTO review_answer_processing(profile_id,session_id,answer_id,material_hash,discovery_hash,
      derivation_job_id,derivation_request_version,reading_job_id,reading_request_version,signal_ids,derived_at)
      VALUES(${profile.id},${session.id},${answerId},${material.hash},${material.hash},${derivation.id},${derivation.request_version},
        ${readingJob.jobId},${readingJob.requestVersion},ARRAY[${signal.id}]::uuid[],now())`;
    await fixture.sql`UPDATE background_jobs SET status='succeeded' WHERE id=${derivation.id}`;
    const current=(await readReviewSession(fixture.db as never,profile.id,session.id))!;
    const chosen=(await chooseReviewItem(fixture.db as never,profile.id,session.id,{revision:current.revision,inspirationId:source.id,sourceRevision:'1',choice:'keep'}))!;
    await completeReviewSession(fixture.db as never,profile.id,session.id,chosen.revision);
    reviewResultFixture={sessionId:session.id,answerId,topOfMindId:reading.id};
  }
  } catch(error) { await fixture.cleanup();await getDb().$client.end();throw error; }
}
const [nativeAccount] = await fixture.sql`INSERT INTO accounts(email,onboarding_completed_at) VALUES ('native-capture-fixture@example.test',now()) RETURNING id`;
const [nativeProfile] = await fixture.sql`INSERT INTO profiles(account_id,type,name) VALUES (${nativeAccount.id},'human','Native capture fixture') RETURNING id`;
const nativeToken = await signSessionToken({ profileId: nativeProfile.id, email: 'native-capture-fixture@example.test' });
await createSessionRow({ profileId: nativeProfile.id, token: nativeToken });
let activeToken = token;
const objects = new Map<string, { bytes: Buffer; contentType: string }>();
// Seeded metadata tests rendering and recovery, not live extraction quality.
let linkFixtureInspirationId: string | null = null;
if (process.env.WAKA_LINK_FIXTURE === '1') {
  process.env.WAKA_ENRICHMENT_ALLOWED_HOSTS = '127.0.0.1:3015';
  const bytes = await readFile(resolve('docs/craft/evidence/personal-capture/input-photo.png'));
  objects.set('/capture-fixture/link-preview.png', { bytes, contentType: 'image/png' });
  const [source] = await fixture.sql`INSERT INTO inspirations(profile_id,text,kind)
    VALUES (${profile.id},'I want to leave more room for ideas before deciding what they should become.','link') RETURNING id`;
  linkFixtureInspirationId = source.id;
  await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text,
    title,description,site_name,hostname,preview_image_url)
    VALUES (${profile.id},${source.id},'link','https://example.com/room-to-think','ready','page_body',
    'A seeded article excerpt about making room for unfinished thoughts. This is source material, separate from the personal note.',
    'Make room for unfinished thoughts','A quieter approach to collecting ideas and noticing the connections between them.',
    'Example journal','example.com',${`${origin}/capture-fixture/link-preview.png`})`;
  await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_error_reason)
    VALUES (${profile.id},${source.id},'link','https://example.com/members-only','unavailable','http_403')`;
}
// Opt-in, explicitly synthetic completed transcript for real UI/HTTP/SQL QA.
// It does not call a provider or pretend to be a model-quality evaluation.
let transcriptFixtureId: string | null = null;
let transcriptFixtureInspirationId: string | null = null;
if (process.env.WAKA_TRANSCRIPT_FIXTURE === '1') {
  const bytes = await readFile(resolve('packages/api/test/fixtures/audio/browser-tone.webm'));
  const key = `profiles/${profile.id}/attachments/transcript-fixture.webm`;
  const [source] = await fixture.sql`INSERT INTO inspirations(profile_id,text,kind) VALUES (${profile.id},'Transcript editing fixture','audio') RETURNING id`;
  const [row] = await fixture.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,s3_key,content_type,size,enrichment_status,enrichment_kind,enrichment_text)
    VALUES (${profile.id},${source.id},'audio',${`${origin}/capture-fixture/${key}`},${key},'audio/webm',${bytes.length},'ready','audio_transcription','Leave a little room for good work.') RETURNING id`;
  transcriptFixtureId = row.id;
  transcriptFixtureInspirationId = source.id;
  objects.set(`/capture-fixture/${key}`, { bytes, contentType: 'audio/webm' });
}
let loseResponse = false, loseRequest = false, loseReviewResponse = false, failUpload = false, failUploadAfter = 0, uploadAttempts = 0;
async function body(request: IncomingMessage, limit: number) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > limit) throw new Error('Fixture request too large'); chunks.push(chunk); }
  return Buffer.concat(chunks);
}
const syntheticMicrophone = `<script>
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{configurable:true,value:async()=>{
 const context=new AudioContext(), oscillator=context.createOscillator(), destination=context.createMediaStreamDestination();
 oscillator.frequency.value=220;const gain=context.createGain();gain.gain.value=.05;oscillator.connect(gain);gain.connect(destination);oscillator.start();
 destination.stream.getAudioTracks().forEach(track=>{const stop=track.stop.bind(track);track.stop=()=>{stop();oscillator.stop();void context.close();};});
 return destination.stream;
}});
</script>`;
const syntheticFontFailure=process.env.WAKA_FONT_FAILURE_FIXTURE==='1'?'<script>document.fonts.load=async()=>{throw new Error("Synthetic font failure")};</script>':'';
const dist = resolve('packages/web/dist');
const nativeDist = resolve('tools/e2e/native-capture-spike/dist');
const types: Record<string,string> = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.woff2':'font/woff2', '.svg':'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const target = new URL(request.url ?? '/', origin);
    if (process.env.WAKA_FIXTURE_REQUEST_LOG === '1') console.info('fixture', request.method, target.pathname);
    if (target.pathname === '/fixture/native-login') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': buildSessionCookie(nativeToken, { secure: false }), 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ profileId: nativeProfile.id })); return;
    }
    if (target.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    if (target.pathname.startsWith('/native-probe/')) {
      const suffix = target.pathname.slice('/native-probe/'.length) || 'index.html';
      const path = resolve(nativeDist, suffix); assert.ok(path.startsWith(nativeDist + '/'));
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(await readFile(path)); return;
    }
    if (target.pathname === '/fixture') {
      if(process.env.WAKA_CONVERSATION_FIXTURE==='1'){
        if(target.searchParams.get('fail')==='conversation-reply')failConversationReply=true;
        if(target.searchParams.get('conversation-reply')==='release'){holdConversationReply=false;releaseConversationReply?.();releaseConversationReply=null;await runningConversationReply;runningConversationReply=null;}
        if(['start','complete'].includes(target.searchParams.get('conversation-reply')??'')){
          const {processBackgroundJob,postgresBackgroundJobStore}=await import('../../packages/api/src/lib/queue.js');
          const [pending]=await fixture.sql`SELECT id FROM background_jobs WHERE type='generate_conversation_reply' AND status='pending' ORDER BY created_at LIMIT 1`;
          if(pending){holdConversationReply=target.searchParams.get('conversation-reply')==='start';await fixture.sql`UPDATE background_jobs SET status='running',attempts=1,locked_at=date_trunc('milliseconds',now()) WHERE id=${pending.id}`;
            const job=await getDb().query.backgroundJobs.findFirst({where:(row,{eq})=>eq(row.id,pending.id)});
            runningConversationReply=processBackgroundJob(job!).then(()=>postgresBackgroundJobStore.markSucceeded(job!,null));
            if(!holdConversationReply){await runningConversationReply;runningConversationReply=null;}
          }
        }
      }
      if (target.searchParams.get('account') === 'native') activeToken = nativeToken;
      if (target.searchParams.get('account') === 'primary') activeToken = token;
      if (process.env.WAKA_REFLECTION_FIXTURE === '1' && target.searchParams.get('question') === 'complete') {
        const { processBackgroundJob, postgresBackgroundJobStore } = await import('../../packages/api/src/lib/queue.js');
        const [pending] = await fixture.sql`SELECT id FROM background_jobs WHERE profile_id=${profile.id}
          AND type='generate_reflection_question' AND status='pending' ORDER BY created_at LIMIT 1`;
        if (pending) {
          await fixture.sql`UPDATE background_jobs SET status='running',attempts=1,locked_at=date_trunc('milliseconds',now()) WHERE id=${pending.id}`;
          const job = await getDb().query.backgroundJobs.findFirst({where:(row,{eq})=>eq(row.id,pending.id)});
          await processBackgroundJob(job!); await postgresBackgroundJobStore.markSucceeded(job!,null);
        }
      }
      if(process.env.WAKA_REVIEW_FIXTURE==='1'&&target.searchParams.get('review-question')==='complete'){
        const {processBackgroundJob,postgresBackgroundJobStore}=await import('../../packages/api/src/lib/queue.js');
        const [pending]=await fixture.sql`SELECT id FROM background_jobs WHERE profile_id=${profile.id} AND type='generate_review_question' AND status='pending' ORDER BY created_at LIMIT 1`;
        if(pending){
          await fixture.sql`UPDATE background_jobs SET status='running',attempts=1,locked_at=date_trunc('milliseconds',now()) WHERE id=${pending.id}`;
          const job=await getDb().query.backgroundJobs.findFirst({where:(row,{eq})=>eq(row.id,pending.id)});
          await processBackgroundJob(job!);await postgresBackgroundJobStore.markSucceeded(job!,null);
        }
      }
      if(target.searchParams.get('fail')==='review-response')loseReviewResponse=true;
      if(reviewResultFixture&&target.searchParams.get('review-result')==='complete'){
        const {recordReviewReadingResult}=await import('../../packages/api/src/lib/review-processing.js');
        const [receipt]=await fixture.sql`SELECT reading_job_id,reading_request_version::text FROM review_answer_processing WHERE answer_id=${reviewResultFixture.answerId}`;
        await fixture.db.transaction(tx=>recordReviewReadingResult(tx as never,{profileId:profile.id,jobId:receipt.reading_job_id,
          requestVersion:receipt.reading_request_version,result:{kind:'top_of_mind',topOfMindId:reviewResultFixture!.topOfMindId,version:1,outcome:'changed'}}));
      }
      if(reviewResultFixture&&target.searchParams.get('review-result')==='failed'){
        await fixture.sql`UPDATE background_jobs SET status='failed' WHERE id IN(SELECT reading_job_id FROM review_answer_processing WHERE answer_id=${reviewResultFixture.answerId})`;
      }
      if(reviewResultFixture&&target.searchParams.get('review-result')==='newer'){
        await fixture.sql`UPDATE top_of_minds SET status='superseded' WHERE id=${reviewResultFixture.topOfMindId}`;
        const [later]=await fixture.sql`INSERT INTO top_of_minds(profile_id,version) VALUES(${profile.id},2) RETURNING id`;
        const [entry]=await fixture.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,sort_order)
          VALUES(${later.id},'pattern','A later reading, distinct from the completed review.',0) RETURNING id`;
        await fixture.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id,statement_revision,entry_body_revision)
          VALUES(${entry.id},${reviewEvidenceFixture!.signalId},1,1)`;
      }
      if (target.searchParams.get('fail') === 'save-response') loseResponse = true;
      if (target.searchParams.get('fail') === 'save-request') loseRequest = true;
      if (target.searchParams.get('fail') === 'upload') failUpload = true;
      if (target.searchParams.get('fail') === 'second-upload') failUploadAfter = 2;
      const [counts] = await fixture.sql`SELECT (SELECT count(*)::int FROM inspirations) AS inspirations,
        (SELECT count(*)::int FROM attachments) AS attachments, (SELECT count(*)::int FROM inspiration_save_requests) AS requests`;
      response.writeHead(200, {'Content-Type':'application/json'}); response.end(JSON.stringify({ ...counts, objects: objects.size,
        origin, schema: fixture.schemaName, microphone: 'synthetic tone', failUpload, loseResponse, loseRequest, transcriptFixtureId, transcriptFixtureInspirationId,
        linkFixtureInspirationId, reviewEvidenceFixture, reviewResultFixture, uploadAttempts, failUploadAfter, reflectionCalls, reviewCalls, conversationCalls, activeAccount:activeToken===token?'primary':'native' })); return;
    }
    if (target.pathname.startsWith('/capture-fixture/')) {
      const key = decodeURIComponent(target.pathname);
      if (request.method === 'PUT') {
        uploadAttempts += 1;
        const failThisUpload = failUploadAfter === 1;
        if (failUploadAfter > 0) failUploadAfter -= 1;
        if (failUpload || failThisUpload) { failUpload = false; response.writeHead(503); response.end(); return; }
        const bytes = await body(request, 25 * 1024 * 1024);
        objects.set(key,{bytes,contentType:String(request.headers['content-type'] ?? 'application/octet-stream')});
        response.writeHead(200,{etag:'"fixture"'}); response.end(); return;
      }
      const object = objects.get(key);
      if (!object) { response.writeHead(404); response.end(); return; }
      response.writeHead(200,{'Content-Type':object.contentType,'Content-Length':object.bytes.length});
      response.end(request.method === 'HEAD' ? undefined : object.bytes); return;
    }
    if (target.pathname.startsWith('/api/')) {
      const bytes = ['GET','HEAD'].includes(request.method ?? 'GET') ? undefined : await body(request, 1024 * 1024);
      if (loseRequest && request.method === 'POST' && target.pathname === '/api/inspirations') {
        loseRequest = false; response.destroy(); return;
      }
      const result = await app.fetch(new Request(target,{method:request.method,headers:request.headers as HeadersInit,...(bytes ? {body:bytes} : {})}));
      if(loseReviewResponse&&request.method==='POST'&&/^\/api\/review-sessions\/[^/]+\/answers$/.test(target.pathname)&&result.status===200){loseReviewResponse=false;response.destroy();return;}
      if (loseResponse && request.method === 'POST' && target.pathname === '/api/inspirations' && result.status === 201) {
        loseResponse = false; response.destroy(); return;
      }
      response.writeHead(result.status,Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer())); return;
    }
    const path = target.pathname.startsWith('/assets/') ? resolve(dist,`.${target.pathname}`) : resolve(dist,'index.html');
    assert.ok(path.startsWith(dist + '/'));
    let bytes = await readFile(path);
    if (path.endsWith('index.html')) bytes = Buffer.from(bytes.toString().replace('<head>', '<head>' + syntheticMicrophone + syntheticFontFailure));
    response.writeHead(200,{'Content-Type':types[extname(path)] ?? 'application/octet-stream','Cache-Control':'no-store',
      ...(path.endsWith('index.html') ? {'Set-Cookie':buildSessionCookie(activeToken,{secure:false})} : {})}); response.end(bytes);
  } catch (error) { console.error(error); if (!response.headersSent) response.writeHead(500); response.end('Fixture failed'); }
});
await new Promise<void>(done=>server.listen(3015,'127.0.0.1',done));
console.log(JSON.stringify({origin,schema:fixture.schemaName,profileId:profile.id,microphone:'synthetic tone',storage:'in-memory S3 transport'}));
let closing=false;
async function close(){if(closing)return;closing=true;await new Promise<void>(done=>server.close(()=>done()));await fixture.cleanup();await getDb().$client.end();process.exit(0);}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
