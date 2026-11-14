/**
 * ASK THE MEMORY, AND THE ASKING IS ON THE RECORD.
 *
 * Claims:
 *   1. A question comes back as the standing signals nearest it — floored at
 *      `RECALL_MIN_COSINE`, strongest first, matches only (a far signal and
 *      a dismissed one never appear), each with live confidence.
 *   2. The question embeds as a RETRIEVAL_QUERY — the other half of the
 *      asymmetric pairing every stored vector was written in.
 *   3. Every serve writes the same `signals` consultation row a list-read
 *      writes: a question about someone's mind is a read of it.
 *   4. The access matrix holds: another account's profile answers 404,
 *      exactly as the signals door answers.
 *
 * WHAT THIS MOCKS, AND WHY: the embedding client — a scripted vector,
 * because the subject is the door and the arithmetic, not Gemini. The
 * database is real.
 */
import {randomUUID} from "node:crypto";
import {createReviewSession} from "../lib/review-sessions.js";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import {hashEmbeddingInput} from "../lib/inspiration-embeddings.js";
import type { GeminiEmbeddingClient } from "../lib/inspiration-embeddings.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";
import { createRecallRoutes } from "./recall.js";

let t: TestDatabase;
let seq = 0;

interface Person {
  profileId: string;
  session: AuthenticatedSession;
}

async function seedPerson(name: string): Promise<Person> {
  seq += 1;
  const email = `recall-${seq}@example.test`;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${email}) RETURNING id`;
  const [profile] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  const [sessionRow] = await t.sql`
    INSERT INTO sessions (profile_id, token_hash, expires_at)
    VALUES (${profile.id}, ${String(seq).padStart(64, "7")}, now() + interval '1 day') RETURNING id`;
  return {
    profileId: profile.id as string,
    session: {
      sessionId: sessionRow.id as string,
      account: { id: account.id as string, email },
      profile: {
        id: profile.id as string,
        accountId: account.id as string,
        type: "human",
        name,
        preferredLocale: "en-US",
      },
    },
  };
}

async function seedSignal(
  profileId: string,
  statement: string,
  embedding: number[],
  opts: { dismissed?: boolean } = {},
): Promise<string> {
  const [signal] = await t.sql`
    INSERT INTO signals (profile_id, statement, status, confidence, dismissed_at)
    VALUES (${profileId}, ${statement}, ${opts.dismissed ? "retired" : "emerging"}, 0,
            ${opts.dismissed ? new Date().toISOString() : null})
    RETURNING id`;
  await t.sql`
    INSERT INTO signal_embeddings (profile_id, signal_id, model, dimensions, input_hash, embedding)
    VALUES (${profileId}, ${signal.id}, 'bench-model', ${embedding.length},
            ${hashEmbeddingInput(statement)}, ${JSON.stringify(embedding)}::jsonb)`;
  const [insp] = await t.sql`
    INSERT INTO inspirations (profile_id, text) VALUES (${profileId}, ${`behind: ${statement}`}) RETURNING id`;
  await t.sql`
    INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
    VALUES (${profileId}, ${profileId}, ${signal.id}, ${insp.id})`;
  return signal.id as string;
}

function scriptedEmbedder(vector: number[]): {
  client: GeminiEmbeddingClient;
  calls: Array<{ input: string; taskType?: string }>;
} {
  const calls: Array<{ input: string; taskType?: string }> = [];
  return {
    calls,
    client: {
      model: "bench-model",
      async embed(input, taskType) {
        calls.push({ input, taskType });
        return vector;
      },
    },
  };
}

const authAs = (session: AuthenticatedSession) => {
  return async (
    c: { set: (k: "session", v: AuthenticatedSession) => void },
    next: () => Promise<void>,
  ) => {
    c.set("session", session);
    await next();
  };
};

function appFor(person: Person, client: GeminiEmbeddingClient): Hono {
  const app = new Hono<AuthEnv>();
  app.route(
    "/api/recall",
    createRecallRoutes({
      getDatabase: () => t.db as never,
      authMiddleware: authAs(person.session) as never,
      embedClient: client,
      dimensions: 3,
    }),
  );
  return app as unknown as Hono;
}

const NEAR = [1, 0.1, 0];
const NEARISH = [0.9, 0.35, 0.1];
const FAR = [0, 0, 1];

afterAll(async () => {
  await t?.cleanup();
});

describe("recall — ask the memory", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("answers with the nearest standing signals, floored, strongest first, on the record", async () => {
    const person = await seedPerson("Asker");
    const nearest = await seedSignal(person.profileId, "Small tools beat grand systems.", NEAR);
    const second = await seedSignal(person.profileId, "Simple beats clever, usually.", NEARISH);
    await seedSignal(person.profileId, "Walking untangles hard problems.", FAR);
    await seedSignal(person.profileId, "A dismissed thought.", NEAR, { dismissed: true });

    const embedder = scriptedEmbedder(NEAR);
    const res = await appFor(person, embedder.client).request(
      "/api/recall?q=what%20do%20I%20think%20about%20tools",
    );
    expect(res.status).toBe(200);
    const { recall } = (await res.json()) as {
      recall: { matches: Array<{ signalId: string; similarity: number; confidence: number }> };
    };

    expect(recall.matches.map((m) => m.signalId)).toEqual([nearest, second]);
    expect(recall.matches[0]!.similarity).toBeGreaterThan(recall.matches[1]!.similarity);
    expect(recall.matches[0]!.confidence, "live confidence, not the snapshot").toBeGreaterThan(0);

    expect(embedder.calls).toHaveLength(1);
    expect(embedder.calls[0]!.taskType, "a question is a QUERY, not a document").toBe(
      "RETRIEVAL_QUERY",
    );

    const record = await t.sql`
      SELECT surface FROM consultations WHERE profile_id = ${person.profileId}`;
    expect(record, "the asking is a read, and a read is on the record").toHaveLength(1);
    expect(record[0]!.surface).toBe("signals");
  });

  it("a question that lands on nothing answers honestly with nothing", async () => {
    const person = await seedPerson("Quiet");
    await seedSignal(person.profileId, "Walking untangles hard problems.", FAR);
    const embedder = scriptedEmbedder(NEAR);
    const res = await appFor(person, embedder.client).request("/api/recall?q=tools");
    const { recall } = (await res.json()) as { recall: { matches: unknown[] } };
    expect(recall.matches).toEqual([]);
  });

  it("another account's profile answers 404, exactly as the signals door does", async () => {
    const asker = await seedPerson("Asker");
    const stranger = await seedPerson("Stranger");
    const embedder = scriptedEmbedder(NEAR);
    const res = await appFor(asker, embedder.client).request(
      `/api/recall?q=anything&profile=${stranger.profileId}`,
    );
    expect(res.status).toBe(404);
  });

  it('does not spend on an empty eligible vector set', async () => {
    const person = await seedPerson('Empty');
    const embedder = scriptedEmbedder(NEAR);
    expect((await appFor(person, embedder.client).request('/api/recall?q=tools')).status).toBe(200);
    expect(embedder.calls).toHaveLength(0);
  });

  it('does not serve an old claim after its source changes during provider HTTP', async () => {
    const person = await seedPerson('Edited');
    const id = await seedSignal(person.profileId, 'A formerly supported claim', NEAR);
    const client = {model:'bench-model', embed:async () => {
      await t.sql`UPDATE inspirations SET text='Changed source words' WHERE profile_id=${person.profileId}`;
      return NEAR;
    }};
    const result = await (await appFor(person,client).request('/api/recall?q=tools')).json() as {recall:{matches:Array<{signalId:string}>}};
    expect(result.recall.matches.map((m:{signalId:string})=>m.signalId)).not.toContain(id);
  });

  it('preserves but does not recall human-locked unsupported words as standing evidence', async () => {
    const person=await seedPerson('Locked');
    const id=await seedSignal(person.profileId,'Exact human words',NEAR);
    await t.sql`UPDATE signals SET locked_at=now(),unsupported_at=now() WHERE id=${id}`;
    const result=await (await appFor(person,scriptedEmbedder(NEAR).client).request('/api/recall?q=tools')).json() as {recall:{matches:Array<{signalId:string}>}};
    expect(result.recall.matches).toEqual([]);
    expect((await t.sql`SELECT statement FROM signals WHERE id=${id}`)[0]!.statement).toBe('Exact human words');
  });
  it.each(['model','dimensions','hash'] as const)('refuses incompatible vector %s before spending',async kind=>{
    const p=await seedPerson(kind);const id=await seedSignal(p.profileId,'Current statement',NEAR);
    if(kind==='model')await t.sql`UPDATE signal_embeddings SET model='another-space' WHERE signal_id=${id}`;
    if(kind==='dimensions')await t.sql`UPDATE signal_embeddings SET dimensions=2 WHERE signal_id=${id}`;
    if(kind==='hash')await t.sql`UPDATE signal_embeddings SET input_hash=${hashEmbeddingInput('old words')} WHERE signal_id=${id}`;
    const fake=scriptedEmbedder(NEAR);
    const r=await (await appFor(p,fake.client).request('/api/recall?q=tools')).json() as {recall:{state:string;matches:unknown[]}};
    expect(r.recall).toMatchObject({state:'empty',matches:[]});expect(fake.calls).toHaveLength(0);
    expect(await t.sql`SELECT * FROM account_recall_limits WHERE account_id=${p.session.account.id}`).toHaveLength(0);
  });
  it.each(['delete','exclude','statement','vector'] as const)('rechecks %s after HTTP without rewriting owner words',async mode=>{
    const p=await seedPerson(mode);const id=await seedSignal(p.profileId,'Original claim',NEAR);
    const client={model:'bench-model',embed:async()=>{
      if(mode==='delete')await t.sql`DELETE FROM inspirations WHERE profile_id=${p.profileId}`;
      if(mode==='exclude')await t.sql`UPDATE inspirations SET memory_excluded_at=now() WHERE profile_id=${p.profileId}`;
      if(mode==='statement')await t.sql`UPDATE signals SET statement='Owner replacement',locked_at=now() WHERE id=${id}`;
      if(mode==='vector')await t.sql`UPDATE signal_embeddings SET input_hash='not-current' WHERE signal_id=${id}`;
      return NEAR;
    }};
    const r=await (await appFor(p,client).request('/api/recall?q=tools')).json() as {recall:{matches:unknown[]}};
    expect(r.recall.matches).toEqual([]);
    expect((await t.sql`SELECT statement FROM signals WHERE id=${id}`)[0]!.statement).toBe(mode==='statement'?'Owner replacement':'Original claim');
  });
  it('never invents semantic scores or exposes provider text on HTTP failure',async()=>{
    const p=await seedPerson('Failure');await seedSignal(p.profileId,'A current claim',NEAR);
    const r=await appFor(p,{model:'bench-model',embed:async()=>{throw new Error('PRIVATE_CANARY_secret_url_prompt');}}).request('/api/recall?q=tools');
    expect(r.status).toBe(503);const text=await r.text();expect(text).toContain('recall_embedding_unavailable');expect(text).not.toContain('PRIVATE_CANARY');
    expect(await t.sql`SELECT minute_count,hour_count FROM account_recall_limits WHERE account_id=${p.session.account.id}`).toEqual([{minute_count:1,hour_count:1}]);
    expect(await t.sql`SELECT id FROM consultations WHERE profile_id=${p.profileId}`).toHaveLength(1);
  });
  it('ignores wrong-model rows even when they precede a valid current vector',async()=>{
    const p=await seedPerson('Two models');const id=await seedSignal(p.profileId,'Current claim',NEAR);
    await t.sql`INSERT INTO signal_embeddings(profile_id,signal_id,model,dimensions,input_hash,embedding)
      VALUES(${p.profileId},${id},'aaaa-wrong',3,${hashEmbeddingInput('Current claim')},${JSON.stringify(FAR)}::jsonb)`;
    const r=await (await appFor(p,scriptedEmbedder(NEAR).client).request('/api/recall?q=tools')).json() as {recall:{matches:Array<{signalId:string;locked:boolean;unsupported:boolean}>}};
    expect(r.recall.matches).toMatchObject([{signalId:id,locked:false,unsupported:false}]);
  });

  it('serves review-only witnesses once per independent unit and applies only the current owner verdict',async()=>{
    const p=await seedPerson('Review');const id=await seedSignal(p.profileId,'Current review claim',NEAR);
    const sources=await t.sql`SELECT id FROM inspirations WHERE profile_id=${p.profileId}`;
    const source=sources[0]!.id as string;
    await t.sql`DELETE FROM signal_evidence WHERE signal_id=${id}`;
    const session=(await createReviewSession(t.db as never,p.profileId,{id:randomUUID(),inspirationIds:[source]}))!;
    const answers:string[]=[];
    for(let n=0;n<2;n++){
      const answer=randomUUID();answers.push(answer);
      await t.sql`INSERT INTO review_answers(id,profile_id,session_id,question_job_id,input_hash,context_hash,question,answer,source_count)
        VALUES(${answer},${p.profileId},${session.id},${randomUUID()},'fixture','fixture','What stayed?','A synthetic human answer',1)`;
      await t.sql`INSERT INTO review_answer_sources(profile_id,session_id,answer_id,inspiration_id,source_revision,referenced)
        SELECT ${p.profileId},${session.id},${answer},${source},personal_revision,true FROM inspiration_revisions WHERE inspiration_id=${source}`;
      await t.sql`INSERT INTO signal_review_evidence(profile_id,signal_id,session_id,answer_id,statement_revision,answer_revision,source_count,question_context_included)
        SELECT a.profile_id,${id},a.session_id,a.id,s.statement_revision,a.revision,1,review_question_context_current(a.profile_id,a.session_id,a.id)
        FROM review_answers a JOIN signals s ON s.profile_id=a.profile_id AND s.id=${id} WHERE a.id=${answer}`;
      await t.sql`INSERT INTO signal_review_evidence_sources(profile_id,signal_id,answer_id,inspiration_id,material_revision,referenced)
        SELECT ${p.profileId},${id},${answer},${source},personal_revision,true FROM inspiration_revisions WHERE inspiration_id=${source}`;
    }
    const read=async()=>await (await appFor(p,scriptedEmbedder(NEAR).client).request('/api/recall?q=tools')).json() as {recall:{matches:Array<{signalId:string;evidenceCount:number;confidence:number}>}};
    const first=await read();expect(first.recall.matches).toMatchObject([{signalId:id,evidenceCount:1}]);
    const stranger=await seedPerson('Other');
    await t.sql`INSERT INTO feedback(profile_id,target_type,target_id,value) VALUES(${stranger.profileId},'signal',${id},'true')`;
    expect((await read()).recall.matches[0]!.confidence).toBe(first.recall.matches[0]!.confidence);
    await t.sql`INSERT INTO feedback(profile_id,target_type,target_id,value) VALUES(${p.profileId},'signal',${id},'true')`;
    expect((await read()).recall.matches[0]!.confidence).toBeGreaterThan(first.recall.matches[0]!.confidence);
    await t.sql`UPDATE review_answers SET answer='Changed answer' WHERE id=${answers[0]!}`;
    const fake=scriptedEmbedder(NEAR);const response=await (await appFor(p,fake.client).request('/api/recall?q=tools')).json() as {recall:{matches:unknown[]}};
    expect(response.recall.matches).toEqual([]);expect(fake.calls).toHaveLength(0);
  });

});
