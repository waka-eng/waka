/**
 * Inspiration / attachment / reflection / cluster test fixtures.
 *
 * Mirrors the layout of `./users.ts`:
 *
 *   1. Pure data factories
 *      - `inspirationInsertFactory(userId, overrides?)` → `NewInspiration`
 *      - `attachmentInsertFactory(inspirationId, overrides?)` → `NewAttachment`
 *      - `reflectionInsertFactory(...)` → `NewReflection`
 *
 *   2. Persistence helpers (use `TestDatabase.db`)
 *      - `createInspirationFixture(db, userId, overrides?)`
 *      - `createAttachmentFixture(db, inspirationId, overrides?)`
 *      - `createReflectionFixture(db, userId, inspirationId, overrides?)`
 *
 *   3. Cluster catalog (`CLUSTER_FIXTURES`)
 *      - One canonical inspiration text + (optional) `kind` / `category`
 *        per `Cluster` value, so a test that wants representative seed
 *        data per classification bucket can do:
 *
 *           for (const [cluster, sample] of Object.entries(CLUSTER_FIXTURES)) {
 *             await createInspirationFixture(db, userId, {
 *               text: sample.text,
 *               cluster: cluster as Cluster,
 *               classifiedAt: new Date(),
 *             });
 *           }
 *
 *      The catalog is also the one place where the human-readable
 *      semantics of each cluster live in test code, which keeps the
 *      classifier-worker assertions readable ("should label X as `loop`")
 *      without scattering magic strings.
 *
 *   4. Bulk seeding helpers
 *      - `seedClusterCatalog(db, userId)` inserts one inspiration per
 *        cluster value plus a final NULL-cluster row, returning the
 *        inserted rows in catalog order. Useful for list-view tests that
 *        need a deterministic mix of classified + pending inspirations.
 *      - `createInspirationsForUser(db, userId, count, overrides?)`
 *        inserts `count` rows with monotonic, distinguishable text.
 *
 * Determinism
 * -----------
 * Each fixture call mixes a per-process counter with `randomBytes` to
 * produce text + names that are stable across reads but unique across
 * calls, so a parallel test run cannot accidentally collide on a unique
 * constraint or assert against the wrong row.
 *
 * All `Date` values default to `new Date()` at call time. Tests that need
 * deterministic timestamps can override via the `overrides` arg or fake
 * the system clock with vitest's `vi.useFakeTimers`.
 */

import { randomBytes } from "node:crypto";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  attachments,
  type AttachmentType,
  type Cluster,
  clusterEnumValues,
  inspirations,
  type Inspiration,
  type NewAttachment,
  type NewInspiration,
  type NewReflection,
  reflections,
  type Attachment,
  type Reflection,
} from "../../src/db/index.js";

import * as schema from "../../src/db/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Drizzle handle accepted by every persistence helper. See `users.ts` for
 * rationale — kept symmetric across fixture modules.
 */
export type FixtureDb = PostgresJsDatabase<typeof schema>;

// ---------------------------------------------------------------------------
// Determinism counters
// ---------------------------------------------------------------------------

let inspirationCounter = 0;
let attachmentCounter = 0;
let reflectionCounter = 0;

function nextInspirationTag(): string {
  inspirationCounter += 1;
  return `${inspirationCounter}-${randomBytes(3).toString("hex")}`;
}

function nextAttachmentTag(): string {
  attachmentCounter += 1;
  return `${attachmentCounter}-${randomBytes(3).toString("hex")}`;
}

function nextReflectionTag(): string {
  reflectionCounter += 1;
  return `${reflectionCounter}-${randomBytes(3).toString("hex")}`;
}

// ---------------------------------------------------------------------------
// Cluster catalog
// ---------------------------------------------------------------------------

/**
 * Canonical sample inspiration per cluster label. The texts are written so
 * the corresponding cluster is a *plausible* — though not guaranteed —
 * Gemini output: `outlier` reads as a one-off observation, `bridge` reads
 * as a connector between two domains, etc. They are NOT used to test
 * Gemini output (which is mocked elsewhere); they are seed content for
 * list-view + classification-loop integration tests, where the cluster
 * value is set explicitly by the fixture rather than inferred.
 *
 * Keeping one constant per cluster (rather than a free-form generator)
 * gives every cluster-aware test the same readable "given this row labelled
 * X" anchor, so a reader can grep for `bridge` and find every test that
 * touches that bucket.
 */
export const CLUSTER_FIXTURES: Record<
  Cluster,
  { text: string; kind: string; category: number }
> = {
  outlier: {
    text: "A snail's trail looks like a circuit diagram under streetlight.",
    kind: "note",
    category: 0,
  },
  bridge: {
    text: "Sourdough fermentation and version-control branching share the same forking topology.",
    kind: "note",
    category: 1,
  },
  morph: {
    text: "Origami crease patterns gradually transform one polygon into another, frame by frame.",
    kind: "note",
    category: 2,
  },
  convergence: {
    text: "Three independent essays this week reached the same conclusion about attention.",
    kind: "note",
    category: 3,
  },
  tension: {
    text: "Rigorous determinism vs. felt agency — neither side leaves room for the other.",
    kind: "note",
    category: 4,
  },
  loop: {
    text: "The thought I had this morning was the same one I had last Thursday, in a different costume.",
    kind: "note",
    category: 5,
  },
};

/**
 * Re-export the canonical cluster value tuple so a test can iterate cluster
 * labels without re-importing `clusterEnumValues` from the schema barrel.
 */
export const ALL_CLUSTERS = clusterEnumValues;

// ---------------------------------------------------------------------------
// Pure data factories
// ---------------------------------------------------------------------------

export interface InspirationFactoryOverrides extends Partial<NewInspiration> {}

/**
 * Build a `NewInspiration` payload bound to `userId`. Cluster + classifiedAt
 * default to NULL — the production POST contract — so a fixture insert
 * mirrors a freshly-captured row that the classifier worker has not yet
 * processed. Tests that want a pre-classified row should pass
 * `cluster + classifiedAt` overrides explicitly.
 */
export function inspirationInsertFactory(
  userId: string,
  overrides: InspirationFactoryOverrides = {},
): NewInspiration {
  const tag = nextInspirationTag();
  return {
    userId,
    text: `Test inspiration ${tag} — light bends around dense thoughts`,
    kind: "note",
    category: 0,
    cluster: null,
    classifiedAt: null,
    ...overrides,
  };
}

export interface AttachmentFactoryOverrides extends Partial<NewAttachment> {}

/**
 * Build a `NewAttachment` payload. Defaults to a `link` attachment because
 * link rows are the simplest (no S3 object, no contentType assumptions);
 * tests that need image/file rows should pass `type` + `s3Key` +
 * `contentType` + `size` overrides.
 */
export function attachmentInsertFactory(
  inspirationId: string,
  overrides: AttachmentFactoryOverrides = {},
): NewAttachment {
  const tag = nextAttachmentTag();
  const type: AttachmentType = overrides.type ?? "link";
  const base: NewAttachment = {
    inspirationId,
    type,
    url: `https://example.test/attachment-${tag}`,
    name: `attachment-${tag}`,
    s3Key: null,
    contentType: null,
    size: null,
  };
  if (type === "image") {
    base.s3Key = `users/test/attachments/${tag}.png`;
    base.url = `https://example.test/s3/${base.s3Key}`;
    base.contentType = "image/png";
    base.size = 1234;
  } else if (type === "file") {
    base.s3Key = `users/test/attachments/${tag}.pdf`;
    base.url = `https://example.test/s3/${base.s3Key}`;
    base.contentType = "application/pdf";
    base.size = 5678;
  }
  return { ...base, ...overrides };
}

export interface ReflectionFactoryOverrides extends Partial<NewReflection> {}

/**
 * Build a `NewReflection` payload. Defaults to a still-pending reflection
 * (answer = NULL, skipped = false) so the row exercises the most common
 * runtime state.
 */
export function reflectionInsertFactory(
  userId: string,
  inspirationId: string,
  overrides: ReflectionFactoryOverrides = {},
): NewReflection {
  const tag = nextReflectionTag();
  return {
    userId,
    inspirationId,
    question: `What does this remind you of? (#${tag})`,
    answer: null,
    skipped: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

/**
 * Insert a single inspiration row owned by `userId` and return the
 * persisted record (with server-generated `id`, `createdAt`, etc.).
 *
 *   const row = await createInspirationFixture(db, alice.user.id, {
 *     text: "deterministic content",
 *     cluster: "loop",
 *     classifiedAt: new Date("2026-01-01T00:00:00Z"),
 *   });
 */
export async function createInspirationFixture(
  db: FixtureDb,
  userId: string,
  overrides: InspirationFactoryOverrides = {},
): Promise<Inspiration> {
  const payload = inspirationInsertFactory(userId, overrides);
  const [row] = await db.insert(inspirations).values(payload).returning();
  if (!row) {
    throw new Error("createInspirationFixture: insert returned no rows");
  }
  return row;
}

/**
 * Insert a single attachment row attached to `inspirationId`. Pass a
 * `type` override to switch between `link` (default), `image`, and `file`.
 */
export async function createAttachmentFixture(
  db: FixtureDb,
  inspirationId: string,
  overrides: AttachmentFactoryOverrides = {},
): Promise<Attachment> {
  const payload = attachmentInsertFactory(inspirationId, overrides);
  const [row] = await db.insert(attachments).values(payload).returning();
  if (!row) {
    throw new Error("createAttachmentFixture: insert returned no rows");
  }
  return row;
}

/**
 * Insert a single reflection row. Both `userId` and `inspirationId` are
 * required because the reflections table denormalises ownership for
 * single-WHERE tenant isolation (see `schema-reflections.ts`).
 */
export async function createReflectionFixture(
  db: FixtureDb,
  userId: string,
  inspirationId: string,
  overrides: ReflectionFactoryOverrides = {},
): Promise<Reflection> {
  const payload = reflectionInsertFactory(userId, inspirationId, overrides);
  const [row] = await db.insert(reflections).values(payload).returning();
  if (!row) {
    throw new Error("createReflectionFixture: insert returned no rows");
  }
  return row;
}

// ---------------------------------------------------------------------------
// Bulk seeding
// ---------------------------------------------------------------------------

/**
 * Insert `count` inspiration rows for `userId`, each tagged with a
 * monotonic counter so the resulting text values are distinguishable both
 * to a human reading test output and to a `WHERE text = ...` assertion.
 *
 * Returned in insertion order. Tests that rely on `created_at DESC`
 * ordering (the production list view) should reverse the array, or
 * navigate via the database, since INSERT order does not guarantee
 * `created_at` strict monotonicity at sub-millisecond resolution.
 */
export async function createInspirationsForUser(
  db: FixtureDb,
  userId: string,
  count: number,
  overrides: InspirationFactoryOverrides = {},
): Promise<Inspiration[]> {
  if (count <= 0) return [];
  const payloads: NewInspiration[] = [];
  for (let i = 0; i < count; i++) {
    payloads.push(
      inspirationInsertFactory(userId, {
        ...overrides,
        text:
          overrides.text ??
          `Test inspiration ${nextInspirationTag()} (#${i + 1} of ${count})`,
      }),
    );
  }
  const rows = await db.insert(inspirations).values(payloads).returning();
  return rows;
}

/**
 * Result returned by {@link seedClusterCatalog}. Each cluster label maps
 * to its persisted row, and `unclassified` is a final NULL-cluster row so
 * tests can exercise the "row exists but worker hasn't run yet" state in
 * the same fixture call.
 */
export interface ClusterCatalogSeed {
  byCluster: Record<Cluster, Inspiration>;
  unclassified: Inspiration;
}

/**
 * Insert one inspiration per cluster value (using {@link CLUSTER_FIXTURES})
 * plus a final NULL-cluster row, all owned by `userId`. Useful for
 * list-view tests that want a deterministic mix of classified and pending
 * inspirations in a single setup line:
 *
 *   const seed = await seedClusterCatalog(db, alice.user.id);
 *   expect(seed.byCluster.loop.text).toContain("same one I had last Thursday");
 *   expect(seed.unclassified.cluster).toBeNull();
 */
export async function seedClusterCatalog(
  db: FixtureDb,
  userId: string,
): Promise<ClusterCatalogSeed> {
  const now = new Date();
  const byCluster = {} as Record<Cluster, Inspiration>;

  for (const cluster of clusterEnumValues) {
    const sample = CLUSTER_FIXTURES[cluster];
    const row = await createInspirationFixture(db, userId, {
      text: sample.text,
      kind: sample.kind,
      category: sample.category,
      cluster,
      classifiedAt: now,
    });
    byCluster[cluster] = row;
  }

  const unclassified = await createInspirationFixture(db, userId, {
    text: "Pending classification — the worker hasn't run yet.",
    kind: "note",
    category: 9,
    cluster: null,
    classifiedAt: null,
  });

  return { byCluster, unclassified };
}

// ---------------------------------------------------------------------------
// Re-exports — let callers do `import { ... } from "fixtures/inspirations"`
// without a second import for the schema types.
// ---------------------------------------------------------------------------

export { inspirations, attachments, reflections };
export type {
  Inspiration,
  NewInspiration,
  Attachment,
  NewAttachment,
  Reflection,
  NewReflection,
  Cluster,
  AttachmentType,
};
