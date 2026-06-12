import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { count, eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { parse as parseYaml } from "yaml";

import {
  documents,
  inspirations,
} from "../src/db/index.js";
import type { AuthEnv } from "../src/lib/middleware.js";
import { createInspirationsRoutes } from "../src/routes/inspirations.js";
import {
  contentHash,
  type VaultPutResult,
  type VaultStore,
} from "../src/vault/vault.js";
import { createUserFixture, type UserFixture } from "./fixtures/users.js";
import { createTestDatabase, type TestDatabase } from "./helpers/db.js";

class RecordingVault implements VaultStore {
  readonly objects = new Map<string, string>();
  readonly writes: Array<{ path: string; content: string; contentHash: string }> = [];
  failNextPut: Error | null = null;

  async put(path: string, content: string): Promise<VaultPutResult> {
    if (this.failNextPut) {
      const error = this.failNextPut;
      this.failNextPut = null;
      throw error;
    }
    const hash = contentHash(content);
    this.objects.set(path, content);
    this.writes.push({ path, content, contentHash: hash });
    return { contentHash: hash };
  }

  async get(path: string): Promise<string | null> {
    return this.objects.get(path) ?? null;
  }

  async delete(path: string): Promise<void> {
    this.objects.delete(path);
  }

  async *list(prefix: string): AsyncIterable<string> {
    const paths = [...this.objects.keys()].sort();
    for (const path of paths) {
      if (path.startsWith(prefix)) yield path;
    }
  }
}

function authAs(fixture: UserFixture): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    c.set("user", {
      id: fixture.user.id,
      email: fixture.user.email,
      name: fixture.user.name,
      avatarUrl: fixture.user.avatarUrl,
      preferredLocale: "en-US",
    });
    c.set("sessionToken", fixture.token);
    await next();
  };
}

function createVaultBackedApp(input: {
  testDb: TestDatabase;
  vault: VaultStore;
  fixture: UserFixture;
}): Hono<AuthEnv> {
  const app = new Hono<AuthEnv>();
  app.route(
    "/api/inspirations",
    createInspirationsRoutes({
      getDatabase: () => input.testDb.db,
      getVault: () => input.vault,
      authMiddleware: authAs(input.fixture),
      enqueueClassificationJob: async () => {},
    }),
  );
  return app;
}

async function jsonRequest<T>(
  app: Hono<AuthEnv>,
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { error: text };
    }
  }
  return { status: res.status, body: parsed as T };
}

async function documentRow(testDb: TestDatabase, id: string) {
  const rows = await testDb.db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

describe("inspirations route vault materialization", () => {
  let testDb: TestDatabase;

  beforeAll(async () => {
    testDb = await createTestDatabase();
  }, 90_000);

  beforeEach(async () => {
    await testDb.truncateAll();
  });

  afterAll(async () => {
    await testDb?.cleanup();
  });

  it("writes the signal file first, then indexes the final vault document", async () => {
    const fixture = await createUserFixture(testDb.db);
    const vault = new RecordingVault();
    const app = createVaultBackedApp({ testDb, vault, fixture });

    const res = await jsonRequest<{
      inspiration: { id: string; text: string; userId: string };
    }>(app, "POST", "/api/inspirations", {
      text: "  capture a recurring build instinct  ",
      kind: "note",
      selectedText: "recurring build instinct",
    });

    expect(res.status).toBe(201);
    expect(res.body.inspiration).toMatchObject({
      text: "capture a recurring build instinct",
      userId: fixture.user.id,
    });
    expect(vault.writes).toHaveLength(2);
    expect(vault.writes[0]!.path).toBe(vault.writes[1]!.path);

    const draftDoc = parseYaml(vault.writes[0]!.content);
    const finalDoc = parseYaml(vault.writes[1]!.content);
    expect(draftDoc).toMatchObject({
      schema: "waka/signal@v1",
      id: res.body.inspiration.id,
      text: "capture a recurring build instinct",
      sparks: [{ text: "recurring build instinct" }],
    });
    expect(draftDoc.signal_packet).toBeUndefined();
    expect(finalDoc.signal_packet.packet_text).toContain(
      "capture a recurring build instinct",
    );

    const indexed = await documentRow(testDb, res.body.inspiration.id);
    expect(indexed).toMatchObject({
      id: res.body.inspiration.id,
      userId: fixture.user.id,
      docType: "signal",
      path: vault.writes[1]!.path,
      contentHash: vault.writes[1]!.contentHash,
      rev: 1,
    });
    expect(indexed?.searchText).toContain("recurring build instinct");
  });

  it("does not create a DB signal when the canonical file write fails", async () => {
    const fixture = await createUserFixture(testDb.db);
    const vault = new RecordingVault();
    vault.failNextPut = new Error("vault unavailable");
    const app = createVaultBackedApp({ testDb, vault, fixture });

    const res = await jsonRequest<{ error?: string }>(
      app,
      "POST",
      "/api/inspirations",
      { text: "this should not become a DB-only signal" },
    );

    expect(res.status).toBe(500);
    expect(vault.writes).toHaveLength(0);

    const [{ value: signalCount }] = await testDb.db
      .select({ value: count() })
      .from(inspirations)
      .where(eq(inspirations.userId, fixture.user.id));
    const [{ value: documentCount }] = await testDb.db
      .select({ value: count() })
      .from(documents)
      .where(eq(documents.userId, fixture.user.id));
    expect(signalCount).toBe(0);
    expect(documentCount).toBe(0);
  });

  it("rematerializes the vault file and index after new sparks, reflections, and edits", async () => {
    const fixture = await createUserFixture(testDb.db);
    const vault = new RecordingVault();
    const app = createVaultBackedApp({ testDb, vault, fixture });

    const created = await jsonRequest<{
      inspiration: { id: string };
    }>(app, "POST", "/api/inspirations", {
      text: "Original ambition signal",
    });
    expect(created.status).toBe(201);
    const signalId = created.body.inspiration.id;
    const firstIndex = await documentRow(testDb, signalId);
    expect(firstIndex).toBeTruthy();

    const spark = await jsonRequest<{ spark: { id: string } }>(
      app,
      "POST",
      `/api/inspirations/${signalId}/sparks`,
      {
        text: "manual spark added after save",
        isPrimary: true,
      },
    );
    expect(spark.status).toBe(201);

    const reflection = await jsonRequest<{ reflection: { id: string } }>(
      app,
      "POST",
      `/api/inspirations/${signalId}/reflections`,
      {
        question: "What is this pointing at?",
        answer: "A stronger file-first loop.",
      },
    );
    expect(reflection.status).toBe(201);

    const edited = await jsonRequest<{ inspiration: { id: string; text: string } }>(
      app,
      "PATCH",
      `/api/inspirations/${signalId}`,
      {
        text: "Edited ambition signal",
      },
    );
    expect(edited.status).toBe(200);
    expect(edited.body.inspiration.text).toBe("Edited ambition signal");

    const updatedIndex = await documentRow(testDb, signalId);
    expect(updatedIndex?.contentHash).not.toBe(firstIndex?.contentHash);
    expect(updatedIndex?.searchText).toContain("manual spark added after save");

    const latest = vault.writes[vault.writes.length - 1]!;
    expect(updatedIndex?.contentHash).toBe(latest.contentHash);
    const doc = parseYaml(latest.content);
    expect(doc).toMatchObject({
      schema: "waka/signal@v1",
      id: signalId,
      text: "Edited ambition signal",
      reflections: [
        {
          question: "What is this pointing at?",
          answer: "A stronger file-first loop.",
        },
      ],
    });
    expect(doc.sparks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "manual spark added after save",
          is_primary: true,
        }),
      ]),
    );
  }, 60_000);
});
