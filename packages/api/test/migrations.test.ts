import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function repoRoot(): string {
  let cursor = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(cursor, "drizzle/migrations/0007_numerous_doctor_faustus.sql");
    try {
      readFileSync(candidate, "utf8");
      return cursor;
    } catch {
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
  }
  throw new Error("Unable to locate repo root from migrations.test.ts");
}

function migration0007(): string {
  return readFileSync(
    resolve(repoRoot(), "drizzle/migrations/0007_numerous_doctor_faustus.sql"),
    "utf8",
  );
}

function migration0008(): string {
  return readFileSync(
    resolve(repoRoot(), "drizzle/migrations/0008_embedding_candidate_preselection.sql"),
    "utf8",
  );
}

function migration0012(): string {
  return readFileSync(
    resolve(repoRoot(), "drizzle/migrations/0012_locale_preferences.sql"),
    "utf8",
  );
}

function migration0013(): string {
  return readFileSync(
    resolve(repoRoot(), "drizzle/migrations/0013_silly_swarm.sql"),
    "utf8",
  );
}

describe("migration 0007", () => {
  it("cleans up legacy cross-tenant wow_moment_inspirations before adding tenant FKs", () => {
    const sql = migration0007();
    const cleanupCommentIndex = sql.indexOf(
      "previously-invalid cross-tenant wow_moment_inspirations",
    );
    const cleanupDeleteIndex = sql.indexOf(
      'DELETE FROM "wow_moment_inspirations" wmi',
    );
    const setNotNullIndex = sql.indexOf(
      'ALTER TABLE "wow_moment_inspirations" ALTER COLUMN "user_id" SET NOT NULL',
    );
    const inspirationFkIndex = sql.indexOf(
      'ADD CONSTRAINT "wow_moment_inspirations_user_inspiration_fk"',
    );

    expect(cleanupCommentIndex).toBeGreaterThanOrEqual(0);
    expect(cleanupDeleteIndex).toBeGreaterThan(cleanupCommentIndex);
    expect(cleanupDeleteIndex).toBeLessThan(setNotNullIndex);
    expect(cleanupDeleteIndex).toBeLessThan(inspirationFkIndex);
    expect(sql.slice(cleanupDeleteIndex, setNotNullIndex)).toContain(
      'i."user_id" IS DISTINCT FROM wmi."user_id"',
    );
    expect(sql.slice(cleanupDeleteIndex, setNotNullIndex)).toContain(
      "NOT EXISTS",
    );
  });
});


describe("migration 0008", () => {
  it("adds only the non-pgvector candidate preselection index", () => {
    const sql = migration0008();

    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS "inspiration_embeddings_user_model_dimensions_idx"',
    );
    expect(sql).toContain('("user_id","model","dimensions")');
    expect(sql).not.toMatch(/\bvector\b|hnsw|vector_cosine_ops|<=>/i);
  });
});

describe("migration 0012", () => {
  it("is registered in Drizzle metadata for deployed migration runs", () => {
    const root = repoRoot();
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string; breakpoints: boolean }> };

    expect(migration0012()).toContain('ALTER TABLE "users" ADD COLUMN "preferred_locale"');
    expect(migration0012()).toContain('ALTER TABLE "wow_moments" ADD COLUMN "locale"');
    expect(journal.entries).toContainEqual(
      expect.objectContaining({ idx: 12, tag: "0012_locale_preferences", breakpoints: true }),
    );
    expect(
      existsSync(resolve(root, "drizzle/migrations/meta/0012_snapshot.json")),
    ).toBe(true);
  });
});

describe("migration 0013", () => {
  it("adds reflection guide storage and metadata for deployed migration runs", () => {
    const root = repoRoot();
    const journal = JSON.parse(
      readFileSync(resolve(root, "drizzle/migrations/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string; breakpoints: boolean }> };

    const snapshot = JSON.parse(
      readFileSync(resolve(root, "drizzle/migrations/meta/0013_snapshot.json"), "utf8"),
    ) as { tables: Record<string, { columns: Record<string, { type: string }> }> };

    expect(migration0013()).toContain('ALTER TABLE "wow_moments" ADD COLUMN "reflection_guide" text');
    expect(
      snapshot.tables["public.wow_moments"]?.columns.reflection_guide,
    ).toMatchObject({ type: "text" });
    expect(journal.entries).toContainEqual(
      expect.objectContaining({ idx: 13, tag: "0013_silly_swarm", breakpoints: true }),
    );
    expect(
      existsSync(resolve(root, "drizzle/migrations/meta/0013_snapshot.json")),
    ).toBe(true);
  });
});
