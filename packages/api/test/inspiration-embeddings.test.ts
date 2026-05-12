import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { inspirationEmbeddings, inspirations } from "../src/db/index.js";
import {
  buildCanonicalInspirationEmbeddingInput,
  ensureInspirationEmbedding,
  hashEmbeddingInput,
  type GeminiEmbeddingClient,
} from "../src/lib/inspiration-embeddings.js";

import { createInspirationFixture } from "./fixtures/inspirations.js";
import { createUserFixture } from "./fixtures/users.js";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";

class MockEmbeddingClient implements GeminiEmbeddingClient {
  readonly model = "text-embedding-004";
  calls: string[] = [];

  async embed(input: string): Promise<number[]> {
    this.calls.push(input);
    return [0.1, 0.2, 0.3];
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
    expect(rows[0]!.dimensions).toBe(3);
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
});
