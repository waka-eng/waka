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
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
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
            ${`hash-${signal.id}`}, ${JSON.stringify(embedding)}::jsonb)`;
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
});
