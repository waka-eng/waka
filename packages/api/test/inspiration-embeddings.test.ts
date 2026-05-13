import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { inspirationEmbeddings, inspirations } from "../src/db/index.js";
import * as dbSchema from "../src/db/index.js";
import {
  buildCanonicalInspirationEmbeddingInput,
  buildEmbedContentUrl,
  ensureInspirationEmbedding,
  GeminiEmbeddingHttpClient,
  hashEmbeddingInput,
  validateEmbeddingVector,
  GEMINI_EMBEDDING_DIMENSIONS,
  type GeminiEmbeddingClient,
} from "../src/lib/inspiration-embeddings.js";

import { createInspirationFixture } from "./fixtures/inspirations.js";
import { createUserFixture } from "./fixtures/users.js";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";


function dbConnectionUrl(): string {
  const url = process.env.DB_CONNECTION_URL;
  if (!url) throw new Error("DB_CONNECTION_URL is required for integration tests");
  return url;
}

function sslMode(connectionString: string): "require" | false {
  return connectionString.includes("sslmode=require") ||
    connectionString.includes("ssl=true")
    ? "require"
    : false;
}

async function createAdditionalDbHandle(schemaName: string) {
  const connectionString = dbConnectionUrl();
  const sql = postgres(connectionString, {
    max: 1,
    prepare: false,
    idle_timeout: 10,
    ssl: sslMode(connectionString),
    onnotice: () => {},
  });
  await sql.unsafe(`SET search_path TO "${schemaName}", public`);
  return { sql, db: drizzle(sql, { schema: dbSchema }) };
}

class MockEmbeddingClient implements GeminiEmbeddingClient {
  readonly model = "text-embedding-004";
  calls: string[] = [];

  async embed(input: string): Promise<number[]> {
    this.calls.push(input);
    return Array.from({ length: GEMINI_EMBEDDING_DIMENSIONS }, (_, index) => index / GEMINI_EMBEDDING_DIMENSIONS);
  }
}

describe("inspiration embedding canonical input", () => {
  it("normalizes line endings and hashes stable canonical bytes", () => {
    const a = buildCanonicalInspirationEmbeddingInput({
      text: "  First line\r\nSecond line  \rThird line\n",
      kind: " note ",
      category: 7,
    });
    const b = buildCanonicalInspirationEmbeddingInput({
      text: "First line\nSecond line\nThird line",
      kind: "note",
      category: 7,
    });

    expect(a).toBe(b);
    expect(a).toBe(
      [
        "waka.inspiration_embedding_input.v1",
        "kind:note",
        "category:7",
        "text:",
        "First line\nSecond line\nThird line",
      ].join("\n"),
    );
    expect(hashEmbeddingInput(a)).toBe(hashEmbeddingInput(b));
    expect(hashEmbeddingInput(a)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes the hash when canonical content changes", () => {
    const base = buildCanonicalInspirationEmbeddingInput({
      text: "same text",
      kind: "note",
      category: 1,
    });
    const changed = buildCanonicalInspirationEmbeddingInput({
      text: "same text with edit",
      kind: "note",
      category: 1,
    });

    expect(hashEmbeddingInput(base)).not.toBe(hashEmbeddingInput(changed));
  });
});

describe("GeminiEmbeddingHttpClient", () => {
  it("sends API keys via x-goog-api-key header and keeps URLs secret-free", async () => {
    const previousKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-embedding-key";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ embedding: { values: Array.from({ length: GEMINI_EMBEDDING_DIMENSIONS }, (_, index) => index / GEMINI_EMBEDDING_DIMENSIONS) } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    try {
      const client = new GeminiEmbeddingHttpClient();
      await expect(client.embed("safe input")).resolves.toHaveLength(GEMINI_EMBEDDING_DIMENSIONS);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0]!;
      expect(String(url)).toBe(buildEmbedContentUrl());
      expect(String(url)).not.toContain("?key=");
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/json",
        "x-goog-api-key": "test-embedding-key",
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousKey;
      }
      fetchMock.mockRestore();
    }
  });
});



describe("embedding vector validation", () => {
  it("rejects vectors with the wrong dimensions", () => {
    expect(() => validateEmbeddingVector([0.1, 0.2], 3)).toThrow(
      "Gemini embedding dimension mismatch",
    );
  });

  it("rejects non-finite vector values", () => {
    expect(() => validateEmbeddingVector([0.1, Number.NaN, 0.3], 3)).toThrow(
      "Gemini embedding contained a non-finite value at index 1",
    );
  });
});

describe("ensureInspirationEmbedding", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  });

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("does not regenerate when the stored input_hash is unchanged", async () => {
    const alice = await createUserFixture(testDb.db);
    const inspiration = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "A stable inspiration for embedding idempotency.",
      kind: "note",
      category: 2,
    });
    const client = new MockEmbeddingClient();

    const first = await ensureInspirationEmbedding({
      db: testDb.db,
      client,
      userId: alice.user.id,
      inspirationId: inspiration.id,
    });
    const second = await ensureInspirationEmbedding({
      db: testDb.db,
      client,
      userId: alice.user.id,
      inspirationId: inspiration.id,
    });

    expect(first.status).toBe("created");
    expect(first.generated).toBe(true);
    expect(second.status).toBe("unchanged");
    expect(second.generated).toBe(false);
    expect(client.calls).toHaveLength(1);
    expect(second.inputHash).toBe(first.inputHash);

    const rows = await testDb.db.select().from(inspirationEmbeddings);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.inputHash).toBe(first.inputHash);
    expect(rows[0]!.dimensions).toBe(GEMINI_EMBEDDING_DIMENSIONS);
  });

  it("regenerates the single stored row when canonical content changes", async () => {
    const alice = await createUserFixture(testDb.db);
    const inspiration = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Original embedding source.",
      kind: "note",
      category: 1,
    });
    const client = new MockEmbeddingClient();

    const first = await ensureInspirationEmbedding({
      db: testDb.db,
      client,
      userId: alice.user.id,
      inspirationId: inspiration.id,
    });

    await testDb.db
      .update(inspirations)
      .set({ text: "Edited embedding source." })
      .where(eq(inspirations.id, inspiration.id));

    const second = await ensureInspirationEmbedding({
      db: testDb.db,
      client,
      userId: alice.user.id,
      inspirationId: inspiration.id,
    });

    expect(second.status).toBe("updated");
    expect(second.generated).toBe(true);
    expect(second.inputHash).not.toBe(first.inputHash);
    expect(client.calls).toHaveLength(2);

    const rows = await testDb.db.select().from(inspirationEmbeddings);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.inputHash).toBe(second.inputHash);
  });

  it("does not persist an embedding when the source changes while Gemini is running", async () => {
    const alice = await createUserFixture(testDb.db);
    const inspiration = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Original source before slow embedding.",
      kind: "note",
      category: 1,
    });
    const client = new MockEmbeddingClient();
    const originalEmbed = client.embed.bind(client);
    const other = await createAdditionalDbHandle(testDb.schemaName);
    try {
      client.embed = async (input: string) => {
        await other.db
          .update(inspirations)
          .set({ text: "Edited while embedding was in flight." })
          .where(eq(inspirations.id, inspiration.id));
        return originalEmbed(input);
      };

      const result = await ensureInspirationEmbedding({
        db: testDb.db,
        client,
        userId: alice.user.id,
        inspirationId: inspiration.id,
      });

      expect(result.status).toBe("stale_source");
      expect(result.embedding).toBeNull();
      expect(result.generated).toBe(true);
      expect(await testDb.db.select().from(inspirationEmbeddings)).toHaveLength(0);
    } finally {
      await other.sql.end({ timeout: 5 });
    }

  });

  it("serializes concurrent generation with an advisory lock and rechecks the stored row", async () => {
    const alice = await createUserFixture(testDb.db);
    const inspiration = await createInspirationFixture(testDb.db, alice.user.id, {
      text: "Concurrent embedding generation should be idempotent.",
      kind: "note",
      category: 1,
    });
    const client = new MockEmbeddingClient();

    const other = await createAdditionalDbHandle(testDb.schemaName);
    try {
      const [first, second] = await Promise.all([
        ensureInspirationEmbedding({
          db: testDb.db,
          client,
          userId: alice.user.id,
          inspirationId: inspiration.id,
        }),
        ensureInspirationEmbedding({
          db: other.db,
          client,
          userId: alice.user.id,
          inspirationId: inspiration.id,
        }),
      ]);

      expect(new Set([first.status, second.status])).toEqual(new Set(["created", "unchanged"]));
      expect(client.calls).toHaveLength(1);
      expect(await testDb.db.select().from(inspirationEmbeddings)).toHaveLength(1);
    } finally {
      await other.sql.end({ timeout: 5 });
    }
  });

});
