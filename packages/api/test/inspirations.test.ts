/**
 * Inspirations route test suite — covers the create + read surface of
 * `routes/inspirations.ts`.
 *
 * Surface under test
 * ------------------
 * Per Sub-AC 13.3.2, this spec covers the inspiration capture + retrieval
 * endpoints in five buckets:
 *
 *   1. Successful creation                    → POST /api/inspirations (201)
 *   2. Validation errors                      → POST /api/inspirations (400)
 *   3. Listing the caller's own inspirations  → GET  /api/inspirations (200, scoped)
 *   4. Fetching by id                         → GET  /api/inspirations/:id/reflections
 *                                                + locating a specific row in the
 *                                                  list response (no dedicated
 *                                                  single-row endpoint exists for
 *                                                  inspirations themselves)
 *   5. Authentication required                → 401 on every endpoint when no
 *                                                  session is presented.
 *
 * Why we drive the live Hono `app`
 * --------------------------------
 * Mocking the Drizzle layer here would replace the most failure-prone parts
 * of the contract — tenant scope (`WHERE user_id = caller`), zod-strip of
 * forged client fields, FK CASCADE, the partial `cluster IS NULL` index used
 * by the queue worker — with hand-written stubs that drift from production.
 * Round-tripping through the real Hono app + the `getDb()` singleton pinned
 * to Neon is the only way to know the route + schema actually meet the
 * Seed's `data_isolation` evaluation principle.
 *
 * Cleanup
 * -------
 * Every user inserted by `createUserFixture` is tracked via
 * `createCleanupTracker()` and reaped in `afterEach`. FK CASCADE on
 * `inspirations.user_id` (and `attachments.inspiration_id` /
 * `reflections.inspiration_id`) removes every child row in one round-trip.
 * `afterAll` flushes a second time as belt-and-braces against an aborted
 * test that skipped its own afterEach.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { count, eq } from "drizzle-orm";

import {
  attachments,
  backgroundJobs,
  inspirationRevisitEvents,
  inspirationSparks,
  inspirations,
  meaningPackets,
} from "../src/db/index.js";
import { getDb } from "../src/lib/db.js";
import { calculateDisplayedInspirationScore } from "../src/lib/inspiration-scores.js";
import { persistSignalPacketForSignal } from "../src/lib/signal-packets.js";
import { createUserFixture } from "./fixtures/users.js";
import {
  apiRequest,
  authedClient,
  createCleanupTracker,
} from "./helpers/index.js";

// ---------------------------------------------------------------------------
// Cleanup wiring
// ---------------------------------------------------------------------------

const cleanup = createCleanupTracker();

afterEach(async () => {
  await cleanup.flush();
});

afterAll(async () => {
  await cleanup.flush();
});

// ---------------------------------------------------------------------------
// Pre-flight env tripwire — surfaces a clear error when `.env` failed to load
// rather than a confusing 500 from the route.
// ---------------------------------------------------------------------------

beforeAll(() => {
  expect(process.env.DB_CONNECTION_URL, "DB_CONNECTION_URL").toBeTruthy();
  expect(
    process.env.JWT_SECRET ?? process.env.AUTH_SECRET,
    "JWT_SECRET or AUTH_SECRET",
  ).toBeTruthy();
});

// ---------------------------------------------------------------------------
// Type aliases for response shapes (call-site narrowing only — the harness
// does not enforce these at runtime).
// ---------------------------------------------------------------------------

interface ApiInspiration {
  id: string;
  userId: string;
  text: string;
  kind: string | null;
  category: number | null;
  importanceScore: number;
  wowScore: number;
  cluster: string | null;
  classifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  signalScores?: {
    resonance: number;
    recurrence: number;
    agency: number;
    identitySignal: number;
    decisionRelevance: number;
  };
  signal?: {
    id: string;
    userId: string;
    text: string;
    kind: string | null;
    category: number | null;
    scores: {
      resonance: number;
      recurrence: number;
      agency: number;
      identitySignal: number;
      decisionRelevance: number;
    };
    capturedAt: string;
    updatedAt: string;
    interpretation: {
      cluster: string | null;
      classifiedAt: string | null;
    };
    legacy: {
      inspirationId: string;
      importanceScore: number;
      wowScore: number;
    };
  };
  attachments?: Array<{
    id: string;
    type: string;
    url?: string;
    name: string | null;
    s3Key?: string | null;
    enrichment: {
      status: string;
      source: string | null;
      sourceUrl: string | null;
      errorReason: string | null;
      link: { hostname: string | null; finalUrl: string | null } | null;
      image: { filename: string | null; contentType: string | null; size: number | null } | null;
    };
  }>;
}

interface CreateInspirationResponse {
  inspiration: ApiInspiration;
}

interface ListInspirationsResponse {
  inspirations: ApiInspiration[];
}

interface ApiInspirationSpark {
  id: string;
  userId: string;
  inspirationId: string;
  text: string;
  source: string;
  startOffset: number | null;
  endOffset: number | null;
  confidence: number;
  isPrimary: boolean;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListSparksResponse {
  sparks: ApiInspirationSpark[];
}

interface CreateSparkResponse {
  spark: ApiInspirationSpark;
}

interface ValidationErrorResponse {
  error: string;
  details?: Record<string, string[] | undefined>;
}

interface RevisitResponse {
  revisit: {
    id: string;
    eventType: string;
    createdAt: string;
  };
  inspiration: {
    id: string;
    importanceScore: number;
    wowScore: number;
  } | null;
}

interface ScoreBreakdownResponse {
  scoreBreakdown: {
    factors: {
      revisit: {
        uniqueRevisitDays: number;
        totalRevisitCount: number;
        recentRevisitCount: number;
        uniqueRevisitDaysScore: number;
        totalRevisitCountScore: number;
        revisitedInLast7DaysScore: number;
      };
    };
  };
}

interface ReflectionResponse {
  reflection: {
    id: string;
    inspirationId: string;
    userId: string;
    question: string;
    answer: string | null;
    skipped: boolean;
    createdAt: string;
  };
}

interface ListReflectionsResponse {
  reflections: ReflectionResponse["reflection"][];
}

// ---------------------------------------------------------------------------
// POST /api/inspirations — successful creation
// ---------------------------------------------------------------------------

describe("POST /api/inspirations — successful creation", () => {
  it("returns 201 with a fully-populated row on the happy path", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      {
        text: "  light bends around dense thoughts  ",
        kind: "note",
        category: 3,
      },
    );

    expect(res.status).toBe(201);
    const row = res.body.inspiration;
    expect(row).toBeTruthy();
    // Server-generated id, matches the uuid v4 surface shape.
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    // Tenant scope: the row is bound to the authenticated caller, period.
    expect(row.userId).toBe(fixture.user.id);
    // zod's `.trim()` normalisation must have stripped the surrounding
    // whitespace before persistence.
    expect(row.text).toBe("light bends around dense thoughts");
    expect(row.kind).toBe("note");
    expect(row.category).toBe(3);
    // Cluster classification is asynchronous — POST must NEVER return a
    // cluster value (the queue worker fills it later).
    expect(row.cluster).toBeNull();
    expect(row.classifiedAt).toBeNull();
    expect(typeof row.createdAt).toBe("string");
    expect(typeof row.updatedAt).toBe("string");

    // The inserted row really exists in the DB and matches the response.
    const dbRows = await getDb()
      .select({
        id: inspirations.id,
        userId: inspirations.userId,
        text: inspirations.text,
        importanceScore: inspirations.importanceScore,
        wowScore: inspirations.wowScore,
        createdAt: inspirations.createdAt,
        cluster: inspirations.cluster,
      })
      .from(inspirations)
      .where(eq(inspirations.id, row.id));
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.userId).toBe(fixture.user.id);
    expect(dbRows[0]!.text).toBe("light bends around dense thoughts");
    expect(row.importanceScore).toEqual(expect.any(Number));
    expect(row.wowScore).toEqual(expect.any(Number));
    expect(row.signalScores).toEqual({
      resonance: row.wowScore,
      recurrence: row.wowScore,
      agency: row.importanceScore,
      identitySignal: row.importanceScore,
      decisionRelevance: row.importanceScore,
    });
    expect(row.signal).toMatchObject({
      id: row.id,
      userId: fixture.user.id,
      text: "light bends around dense thoughts",
      kind: "note",
      category: 3,
      scores: row.signalScores,
      capturedAt: row.createdAt,
      updatedAt: row.updatedAt,
      interpretation: {
        cluster: null,
        classifiedAt: null,
      },
      legacy: {
        inspirationId: row.id,
        importanceScore: row.importanceScore,
        wowScore: row.wowScore,
      },
    });
    expect(dbRows[0]!.importanceScore).toBe(row.importanceScore);
    expect(row.wowScore).toBe(
      calculateDisplayedInspirationScore({
        coreWowScore: dbRows[0]!.wowScore,
        createdAt: dbRows[0]!.createdAt,
        now: new Date(row.createdAt),
      }),
    );
    expect(dbRows[0]!.wowScore).not.toBe(row.wowScore);
    expect(dbRows[0]!.cluster).toBeNull();

    const jobs = await getDb()
      .select({
        id: backgroundJobs.id,
        userId: backgroundJobs.userId,
        type: backgroundJobs.type,
        payload: backgroundJobs.payload,
        status: backgroundJobs.status,
      })
      .from(backgroundJobs)
      .where(eq(backgroundJobs.userId, fixture.user.id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.type).toBe("process_inspiration");
    expect(jobs[0]!.payload).toEqual({ inspirationId: row.id });
    expect(jobs[0]!.userId).toBe(fixture.user.id);
    expect(["pending", "running", "succeeded", "failed"]).toContain(
      jobs[0]!.status,
    );
    expect("autoWowGeneration" in res.body).toBe(false);
  });

  it("accepts a minimal payload (text only) and defaults kind/category to NULL", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "minimal payload" },
    );

    expect(res.status).toBe(201);
    expect(res.body.inspiration.text).toBe("minimal payload");
    expect(res.body.inspiration.kind).toBeNull();
    expect(res.body.inspiration.category).toBeNull();
    expect(res.body.inspiration.userId).toBe(fixture.user.id);
  });

  it("persists and lists bounded MVP capture kinds for note, link, image, and mixed inputs", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const captures = [
      { text: "kind note payload", kind: "note" },
      { text: "https://example.com/kind-link", kind: "link" },
      { text: "Image inspiration", kind: "image" },
      { text: "Mixed inspiration", kind: "mixed" },
    ];

    for (const capture of captures) {
      const res = await client.json<CreateInspirationResponse>(
        "POST",
        "/api/inspirations",
        capture,
      );
      expect(res.status).toBe(201);
      expect(res.body.inspiration.text).toBe(capture.text);
      expect(res.body.inspiration.kind).toBe(capture.kind);
      expect(res.body.inspiration.userId).toBe(fixture.user.id);
    }

    const listed = await client.json<ListInspirationsResponse>(
      "GET",
      "/api/inspirations",
    );
    expect(listed.status).toBe(200);
    const kindByText = new Map(
      listed.body.inspirations.map((row) => [row.text, row.kind]),
    );
    expect(kindByText.get("kind note payload")).toBe("note");
    expect(kindByText.get("https://example.com/kind-link")).toBe("link");
    expect(kindByText.get("Image inspiration")).toBe("image");
    expect(kindByText.get("Mixed inspiration")).toBe("mixed");
    for (const row of listed.body.inspirations) {
      expect(row.signal?.id).toBe(row.id);
      expect(row.signal?.scores).toEqual(row.signalScores);
      expect(row.signalScores).toEqual(
        expect.objectContaining({
          resonance: expect.any(Number),
          recurrence: expect.any(Number),
          agency: expect.any(Number),
          identitySignal: expect.any(Number),
          decisionRelevance: expect.any(Number),
        }),
      );
    }
  }, 60_000);



  it("lists attachments with enrichment metadata while keeping old rows neutral", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "link with enrichment", kind: "link" },
    );
    expect(created.status).toBe(201);

    await getDb().insert(attachments).values({
      inspirationId: created.body.inspiration.id,
      type: "link",
      url: "https://example.com/list-preview",
      name: "Example list preview",
      s3Key: null,
      contentType: null,
      size: null,
      enrichmentStatus: "ready",
      enrichmentSource: "url",
      enrichmentSourceUrl: "https://example.com/list-preview",
      enrichmentErrorReason: null,
      finalUrl: "https://example.com/list-preview",
      hostname: "example.com",
      title: null,
      description: null,
      siteName: null,
      previewImageUrl: null,
      imageWidth: null,
      imageHeight: null,
    });

    await getDb().insert(attachments).values({
      inspirationId: created.body.inspiration.id,
      type: "file",
      url: "https://bucket.example.com/legacy.pdf",
      name: "legacy.pdf",
      s3Key: "users/test/attachments/legacy.pdf",
      contentType: "application/pdf",
      size: 100,
      enrichmentSourceUrl: "https://bucket.example.com/legacy.pdf",
    });

    const listed = await client.json<ListInspirationsResponse>(
      "GET",
      "/api/inspirations",
    );
    expect(listed.status).toBe(200);
    const row = listed.body.inspirations.find((item) => item.id === created.body.inspiration.id);
    expect(row?.attachments).toHaveLength(2);
    const responseJson = JSON.stringify(row?.attachments);
    expect(responseJson).not.toContain("users/test/attachments/legacy.pdf");
    expect(responseJson).not.toContain("https://bucket.example.com/legacy.pdf");
    expect(row?.attachments?.find((att) => att.type === "link")?.enrichment).toMatchObject({
      status: "ready",
      source: "url",
      errorReason: null,
      link: {
        hostname: "example.com",
        finalUrl: "https://example.com/list-preview",
      },
      image: null,
    });
    const fileAttachment = row?.attachments?.find((att) => att.type === "file");
    expect(fileAttachment).not.toHaveProperty("url");
    expect(fileAttachment).not.toHaveProperty("s3Key");
    expect(fileAttachment?.enrichment.sourceUrl).toBeNull();
    expect(fileAttachment?.enrichment).toMatchObject({
      status: "ready",
      link: null,
      image: null,
    });
  });

  it("rejects non-MVP capture kinds", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<ValidationErrorResponse>(
      "POST",
      "/api/inspirations",
      { text: "bad kind", kind: "bookmark" },
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid inspiration payload");
    expect(res.body.details?.kind?.[0]).toBe("Kind must be note, link, image, or mixed");
  });

  it("ignores a forged userId in the request body — auth context wins", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    // The zod schema is .strict() in spirit (no `userId` field declared) so
    // an attempt to forge ownership is silently dropped before the SQL runs.
    // Guard the regression here so a future schema-loosening bug surfaces
    // immediately rather than as a tenant-isolation incident in production.
    const res = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      {
        text: "should still belong to me",
        userId: "00000000-0000-0000-0000-000000000000",
        user_id: "00000000-0000-0000-0000-000000000000",
      },
    );

    expect(res.status).toBe(201);
    expect(res.body.inspiration.userId).toBe(fixture.user.id);
    expect(res.body.inspiration.userId).not.toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("persists selected text as the primary spark alongside the full artifact", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const text =
      "The full essay gives context. The sentence that moved me is here. More context follows.";
    const selectedText = "The sentence that moved me is here.";
    const start = text.indexOf(selectedText);
    const end = start + selectedText.length;

    const res = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      {
        text,
        selectedText,
        selectionStart: start,
        selectionEnd: end,
      },
    );

    expect(res.status).toBe(201);
    expect(res.body.inspiration.text).toBe(text);

    const rows = await getDb()
      .select()
      .from(inspirationSparks)
      .where(eq(inspirationSparks.inspirationId, res.body.inspiration.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(fixture.user.id);
    expect(rows[0]!.text).toBe(selectedText);
    expect(rows[0]!.source).toBe("user_selected");
    expect(rows[0]!.startOffset).toBe(start);
    expect(rows[0]!.endOffset).toBe(end);
    expect(rows[0]!.confidence).toBe(100);
    expect(rows[0]!.isPrimary).toBe(true);

    const packets = await getDb()
      .select()
      .from(meaningPackets)
      .where(eq(meaningPackets.inspirationId, res.body.inspiration.id));

    expect(packets).toHaveLength(1);
    expect(packets[0]!.userId).toBe(fixture.user.id);
    expect(packets[0]!.primarySparkId).toBe(rows[0]!.id);
    expect(packets[0]!.sparkText).toBe(selectedText);
    expect(packets[0]!.artifactExcerpt).toContain("The full essay gives context.");
    expect(packets[0]!.packetText).toContain("WHAT_HIT");
    expect(packets[0]!.packetText).toContain(selectedText);
    expect(packets[0]!.packetText.length).toBeLessThan(text.length + 500);
    expect(packets[0]!.tokenEstimate).toBeLessThan(500);
  });

  it("treats a short standalone save as a user-written spark", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "Build around people who make ambition feel less lonely." },
    );

    expect(res.status).toBe(201);

    const rows = await getDb()
      .select()
      .from(inspirationSparks)
      .where(eq(inspirationSparks.inspirationId, res.body.inspiration.id));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe("Build around people who make ambition feel less lonely.");
    expect(rows[0]!.source).toBe("user_written");
    expect(rows[0]!.isPrimary).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Inspiration sparks — first-class evidence on top of saved artifacts
// ---------------------------------------------------------------------------

describe("Inspiration sparks", () => {
  it("lists and creates sparks for the caller's own inspiration", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "A long article about cities, peers, ambition, and taste." },
    );
    expect(created.status).toBe(201);
    const inspirationId = created.body.inspiration.id;

    const spark = await client.json<CreateSparkResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/sparks`,
      {
        text: "cities send subtle messages about ambition",
        source: "user_added_later",
        confidence: 92,
        isPrimary: true,
        note: "This is the part I want to remember.",
      },
    );

    expect(spark.status).toBe(201);
    expect(spark.body.spark.inspirationId).toBe(inspirationId);
    expect(spark.body.spark.userId).toBe(fixture.user.id);
    expect(spark.body.spark.text).toBe("cities send subtle messages about ambition");
    expect(spark.body.spark.source).toBe("user_added_later");
    expect(spark.body.spark.confidence).toBe(92);
    expect(spark.body.spark.isPrimary).toBe(true);
    expect(spark.body.spark.note).toBe("This is the part I want to remember.");

    const [packet] = await getDb()
      .select()
      .from(meaningPackets)
      .where(eq(meaningPackets.inspirationId, inspirationId));

    expect(packet).toBeTruthy();
    expect(packet!.primarySparkId).toBe(spark.body.spark.id);
    expect(packet!.sparkText).toBe("cities send subtle messages about ambition");
    expect(packet!.packetText).toContain("This is the part I want to remember.");

    const list = await client.get<ListSparksResponse>(
      `/api/inspirations/${inspirationId}/sparks`,
    );

    expect(list.status).toBe(200);
    expect(list.body.sparks.map((row) => row.id)).toContain(spark.body.spark.id);
  }, 60_000);

  it("does not let another user list or create sparks on a private inspiration", async () => {
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);

    const aliceCreate = await authedClient(alice).json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "alice private artifact" },
    );
    expect(aliceCreate.status).toBe(201);
    const aliceInspirationId = aliceCreate.body.inspiration.id;

    const bobList = await authedClient(bob).get<{ error: string }>(
      `/api/inspirations/${aliceInspirationId}/sparks`,
    );
    expect(bobList.status).toBe(404);

    const bobCreate = await authedClient(bob).json<{ error: string }>(
      "POST",
      `/api/inspirations/${aliceInspirationId}/sparks`,
      { text: "try to annotate alice's save" },
    );
    expect(bobCreate.status).toBe(404);
  });

  it("rejects invalid spark payloads", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "parent save for invalid spark" },
    );
    expect(created.status).toBe(201);

    const res = await client.json<ValidationErrorResponse>(
      "POST",
      `/api/inspirations/${created.body.inspiration.id}/sparks`,
      { text: "", confidence: 101 },
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid spark payload/i);
    expect(res.body.details?.text?.[0]).toBeTruthy();
    expect(res.body.details?.confidence?.[0]).toBeTruthy();
  });

  it("keeps one idempotent signal packet per inspiration when rebuilt", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      {
        text: [
          "The artifact can stay long because it is the context.",
          "The spark is the sentence the graph should trust first.",
          "More supporting context follows so the system understands why it mattered.",
        ].join(" "),
        selectedText: "The spark is the sentence the graph should trust first.",
      },
    );
    expect(created.status).toBe(201);

    const firstRows = await getDb()
      .select()
      .from(meaningPackets)
      .where(eq(meaningPackets.inspirationId, created.body.inspiration.id));
    expect(firstRows).toHaveLength(1);
    const first = firstRows[0]!;

    await persistSignalPacketForSignal({
      db: getDb(),
      userId: fixture.user.id,
      signalId: created.body.inspiration.id,
    });

    const secondRows = await getDb()
      .select()
      .from(meaningPackets)
      .where(eq(meaningPackets.inspirationId, created.body.inspiration.id));
    expect(secondRows).toHaveLength(1);
    expect(secondRows[0]!.id).toBe(first.id);
    expect(secondRows[0]!.inputFingerprint).toBe(first.inputFingerprint);
  });

  it("does not build a signal packet across tenant boundaries", async () => {
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);

    const created = await authedClient(alice).json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "alice private signal packet source" },
    );
    expect(created.status).toBe(201);

    const result = await persistSignalPacketForSignal({
      db: getDb(),
      userId: bob.user.id,
      signalId: created.body.inspiration.id,
    });

    expect(result.status).toBe("missing_inspiration");
  });

  it("builds a packet from bounded context when a long save has no designated spark", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const text = [
      "This is a full essay-style capture with no single sentence selected.",
      "It still matters because the whole artifact is the thing the user wanted to keep.",
      "The packet should preserve enough local context for later meaning work without pretending the user highlighted a spark.",
      "Additional context repeats the same point so the test remains safely above the short spark-only heuristic.",
    ].join(" ");

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text },
    );
    expect(created.status).toBe(201);

    const sparks = await getDb()
      .select()
      .from(inspirationSparks)
      .where(eq(inspirationSparks.inspirationId, created.body.inspiration.id));
    expect(sparks).toHaveLength(0);

    const packets = await getDb()
      .select()
      .from(meaningPackets)
      .where(eq(meaningPackets.inspirationId, created.body.inspiration.id));

    expect(packets).toHaveLength(1);
    expect(packets[0]!.primarySparkId).toBeNull();
    expect(packets[0]!.sparkText).toBe("");
    expect(packets[0]!.artifactExcerpt).toContain("full essay-style capture");
    expect(packets[0]!.packetText).toContain("WHAT_HIT\nnone");
    expect(packets[0]!.sourceMetadata).toMatchObject({
      sparkCount: 0,
      hasPrimarySpark: false,
    });
  });
});

// ---------------------------------------------------------------------------
// POST /api/inspirations — validation errors
// ---------------------------------------------------------------------------

describe("POST /api/inspirations — validation errors", () => {
  it("rejects a missing text with 400 + per-field details", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<ValidationErrorResponse>(
      "POST",
      "/api/inspirations",
      { kind: "note" },
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid inspiration payload/i);
    // The frontend renders this directly under the text input; assert the
    // shape so a regression that drops the `details.text` slot fails here.
    expect(res.body.details?.text?.[0]).toBeTruthy();
  });

  it("rejects an empty / whitespace-only text with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<ValidationErrorResponse>(
      "POST",
      "/api/inspirations",
      { text: "   \n  \t  " },
    );

    expect(res.status).toBe(400);
    expect(res.body.details?.text?.[0]).toMatch(/required/i);
  });

  it("rejects a text larger than 8 KB with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    // 8193 chars > 8192 max.
    const huge = "a".repeat(8193);
    const res = await client.json<ValidationErrorResponse>(
      "POST",
      "/api/inspirations",
      { text: huge },
    );

    expect(res.status).toBe(400);
    expect(res.body.details?.text?.[0]).toMatch(/too long/i);
  });

  it("rejects a non-integer category with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<ValidationErrorResponse>(
      "POST",
      "/api/inspirations",
      { text: "hello", category: 1.5 },
    );

    expect(res.status).toBe(400);
    expect(res.body.details?.category?.[0]).toMatch(/integer/i);
  });

  it("rejects a negative category with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<ValidationErrorResponse>(
      "POST",
      "/api/inspirations",
      { text: "hello", category: -1 },
    );

    expect(res.status).toBe(400);
    expect(res.body.details?.category?.[0]).toMatch(/non-negative/i);
  });

  it("rejects a non-JSON body with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    // Bypass the JSON serialiser by passing a raw string — the harness
    // forwards it verbatim because typeof body === "string".
    const res = await client.json<ValidationErrorResponse>(
      "POST",
      "/api/inspirations",
      "<<not json>>",
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/json/i);
  });
});

// ---------------------------------------------------------------------------
// GET /api/inspirations — listing the caller's own rows
// ---------------------------------------------------------------------------

describe("GET /api/inspirations — listing", () => {
  it("returns an empty array for a brand-new user", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.get<ListInspirationsResponse>("/api/inspirations");

    // A fresh user has no rows; the contract is `200 { inspirations: [] }` —
    // never a 404. The empty-state copy lives in the SPA, not the API.
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.inspirations)).toBe(true);
    expect(res.body.inspirations).toHaveLength(0);
  });

  it("returns every row owned by the caller, newest first", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    // Insert three rows in series. The route orders by `created_at DESC`,
    // backed by the `inspirations_user_created_idx` composite index, so the
    // newest insert must come first in the response. We do NOT rely on
    // sub-millisecond precision — we sleep 10ms between inserts to make
    // the timestamps strictly distinct.
    const texts = ["first save", "second save", "third save"];
    for (const text of texts) {
      const created = await client.json<CreateInspirationResponse>(
        "POST",
        "/api/inspirations",
        { text },
      );
      expect(created.status).toBe(201);
      // Tiny pause keeps `created_at` strictly increasing across the trio.
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const res = await client.get<ListInspirationsResponse>("/api/inspirations");

    expect(res.status).toBe(200);
    expect(res.body.inspirations.length).toBeGreaterThanOrEqual(3);
    // Every returned row is owned by the caller — no cross-tenant leak.
    for (const row of res.body.inspirations) {
      expect(row.userId).toBe(fixture.user.id);
    }
    // Newest first: the response order should be third → second → first.
    const recentTexts = res.body.inspirations.slice(0, 3).map((r) => r.text);
    expect(recentTexts).toEqual(["third save", "second save", "first save"]);
    // And `created_at` is monotonically non-increasing across the slice.
    for (let i = 1; i < res.body.inspirations.length; i += 1) {
      const prev = new Date(res.body.inspirations[i - 1]!.createdAt).getTime();
      const cur = new Date(res.body.inspirations[i]!.createdAt).getTime();
      expect(prev).toBeGreaterThanOrEqual(cur);
    }
  });

  it("isolates two users' lists (no cross-tenant rows)", async () => {
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);

    const aliceClient = authedClient(alice);
    const bobClient = authedClient(bob);

    // Alice creates two rows.
    const aliceCreate1 = await aliceClient.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "alice-one" },
    );
    const aliceCreate2 = await aliceClient.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "alice-two" },
    );
    expect(aliceCreate1.status).toBe(201);
    expect(aliceCreate2.status).toBe(201);

    // Bob creates one row.
    const bobCreate = await bobClient.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "bob-one" },
    );
    expect(bobCreate.status).toBe(201);

    // Alice's list contains exactly her two rows, never bob's.
    const aliceList = await aliceClient.get<ListInspirationsResponse>(
      "/api/inspirations",
    );
    expect(aliceList.status).toBe(200);
    const aliceTexts = aliceList.body.inspirations.map((r) => r.text);
    expect(aliceTexts).toContain("alice-one");
    expect(aliceTexts).toContain("alice-two");
    expect(aliceTexts).not.toContain("bob-one");
    for (const row of aliceList.body.inspirations) {
      expect(row.userId).toBe(alice.user.id);
      expect(row.userId).not.toBe(bob.user.id);
    }

    // Bob's list contains exactly his one row, never alice's.
    const bobList = await bobClient.get<ListInspirationsResponse>(
      "/api/inspirations",
    );
    expect(bobList.status).toBe(200);
    const bobTexts = bobList.body.inspirations.map((r) => r.text);
    expect(bobTexts).toEqual(["bob-one"]);
    for (const row of bobList.body.inspirations) {
      expect(row.userId).toBe(bob.user.id);
    }
  });
});

// ---------------------------------------------------------------------------
// "Fetch by id" — locate a specific inspiration via the list response, and
// drive GET /api/inspirations/:id/reflections (the only `:id`-keyed read in the
// inspirations namespace today). Both flows assert the caller can address
// individual rows by id without any cross-tenant leakage.
// ---------------------------------------------------------------------------

describe("Fetching by id", () => {
  it("locates a freshly-created inspiration by id in the list response", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "find-me-by-id", kind: "note", category: 7 },
    );
    expect(created.status).toBe(201);
    const targetId = created.body.inspiration.id;

    // The list endpoint is the canonical read path for inspirations (no
    // dedicated GET /:id exists yet). Filtering the response by id is the
    // public way to "fetch by id" today; a future GET /:id endpoint would
    // be a strict superset and this assertion would still hold.
    const list = await client.get<ListInspirationsResponse>("/api/inspirations");
    expect(list.status).toBe(200);

    const match = list.body.inspirations.find((r) => r.id === targetId);
    expect(match, `expected list to contain ${targetId}`).toBeTruthy();
    expect(match!.userId).toBe(fixture.user.id);
    expect(match!.text).toBe("find-me-by-id");
    expect(match!.kind).toBe("note");
    expect(match!.category).toBe(7);
  });

  it("GET /api/inspirations/:id/reflections returns the reflections attached to that id", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    // Create the inspiration, then attach one reflection.
    const inspirationCreate = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "parent inspiration" },
    );
    expect(inspirationCreate.status).toBe(201);
    const inspirationId = inspirationCreate.body.inspiration.id;

    const reflectionCreate = await client.json<ReflectionResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/reflections`,
      { question: "what does this remind me of?" },
    );
    expect(reflectionCreate.status).toBe(201);
    const reflectionId = reflectionCreate.body.reflection.id;

    // The "fetch by id" path on the inspirations namespace.
    const res = await client.get<ListReflectionsResponse>(
      `/api/inspirations/${inspirationId}/reflections`,
    );
    expect(res.status).toBe(200);
    expect(res.body.reflections).toHaveLength(1);
    expect(res.body.reflections[0]!.id).toBe(reflectionId);
    expect(res.body.reflections[0]!.inspirationId).toBe(inspirationId);
    expect(res.body.reflections[0]!.userId).toBe(fixture.user.id);
    expect(res.body.reflections[0]!.question).toBe(
      "what does this remind me of?",
    );
  }, 60_000);

  it("POST /api/inspirations/:id/reflections enqueues organic WOW re-processing for the reflected inspiration", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const inspirationCreate = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "organic reflection should re-check WOW generation", kind: "note" },
    );
    expect(inspirationCreate.status).toBe(201);
    const inspirationId = inspirationCreate.body.inspiration.id;

    const reflectionCreate = await client.json<ReflectionResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/reflections`,
      {
        question: "Why is this connected to the weird prototype theme?",
        answer: "Because the reflection adds organic context after the original save.",
      },
    );
    expect(reflectionCreate.status).toBe(201);
    const reflectionId = reflectionCreate.body.reflection.id;

    const jobs = await getDb()
      .select({
        id: backgroundJobs.id,
        userId: backgroundJobs.userId,
        type: backgroundJobs.type,
        status: backgroundJobs.status,
        payload: backgroundJobs.payload,
        idempotencyKey: backgroundJobs.idempotencyKey,
      })
      .from(backgroundJobs)
      .where(eq(backgroundJobs.userId, fixture.user.id));

    const processJobsForInspiration = jobs.filter((job) => {
      const payload = job.payload as { inspirationId?: unknown } | null;
      return job.type === "process_inspiration" && payload?.inspirationId === inspirationId;
    });

    expect(processJobsForInspiration.map((job) => job.idempotencyKey).sort()).toEqual([
      `process_inspiration:${inspirationId}`,
      `process_inspiration:${inspirationId}:reflection:${reflectionId}`,
    ]);
    expect(
      processJobsForInspiration.find(
        (job) => job.idempotencyKey === `process_inspiration:${inspirationId}:reflection:${reflectionId}`,
      ),
    ).toMatchObject({
      userId: fixture.user.id,
      status: "pending",
      payload: { inspirationId },
    });
  }, 60_000);

  it("GET /api/inspirations/:id/reflections returns 404 for another user's id (no enumeration)", async () => {
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);

    // Alice creates an inspiration that bob will try to address by id.
    const aliceCreate = await authedClient(alice).json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "alice's private save" },
    );
    expect(aliceCreate.status).toBe(201);
    const aliceInspirationId = aliceCreate.body.inspiration.id;

    // Bob tries to read alice's inspiration by id. The route MUST 404 — a
    // 403 would leak the existence of the row to bob, allowing him to
    // enumerate alice's uuids. 404 is intentional and matches the
    // attachments-finalize convention.
    const res = await authedClient(bob).get<{ error: string }>(
      `/api/inspirations/${aliceInspirationId}/reflections`,
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/inspirations/:id/reflections returns 400 for a malformed id", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.get<{ error: string }>(
      "/api/inspirations/not-a-uuid/reflections",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid inspiration id/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/inspirations/:id/revisits — revisit tracking + scoring
// ---------------------------------------------------------------------------

describe("POST /api/inspirations/:id/revisits", () => {
  async function countRevisitEvents(inspirationId: string): Promise<number> {
    const [row] = await getDb()
      .select({ value: count() })
      .from(inspirationRevisitEvents)
      .where(eq(inspirationRevisitEvents.inspirationId, inspirationId));

    return Number(row?.value ?? 0);
  }

  it("records a revisit event and returns a score patch for the owning user", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "revisit this later" },
    );
    expect(created.status).toBe(201);
    const inspirationId = created.body.inspiration.id;

    const res = await client.json<RevisitResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/revisits`,
      { eventType: "detail_opened" },
    );

    expect(res.status).toBe(201);
    expect(res.body.revisit.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.revisit.eventType).toBe("detail_opened");
    expect(typeof res.body.revisit.createdAt).toBe("string");
    expect(res.body.inspiration).toMatchObject({ id: inspirationId });
    expect(res.body.inspiration?.importanceScore).toEqual(expect.any(Number));
    expect(res.body.inspiration?.wowScore).toEqual(expect.any(Number));
    expect(await countRevisitEvents(inspirationId)).toBe(1);
  });

  it("score breakdown exposes one raw unique day separately from the 33 unique-day signal", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "new inspiration with one detail-open revisit" },
    );
    expect(created.status).toBe(201);
    const inspirationId = created.body.inspiration.id;

    const revisit = await client.json<RevisitResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/revisits`,
      { eventType: "detail_opened" },
    );
    expect(revisit.status).toBe(201);

    const breakdown = await client.json<ScoreBreakdownResponse>(
      "GET",
      `/api/inspirations/${inspirationId}/score-breakdown`,
    );

    expect(breakdown.status).toBe(200);
    expect(breakdown.body.scoreBreakdown.factors.revisit).toMatchObject({
      uniqueRevisitDays: 1,
      totalRevisitCount: 1,
      recentRevisitCount: 1,
      uniqueRevisitDaysScore: 33,
      totalRevisitCountScore: 23,
      revisitedInLast7DaysScore: 100,
    });
  });

  it("returns 404 for another user's inspiration and does not create a revisit", async () => {
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);

    const aliceCreate = await authedClient(alice).json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "alice private revisit target" },
    );
    expect(aliceCreate.status).toBe(201);
    const inspirationId = aliceCreate.body.inspiration.id;

    const res = await authedClient(bob).json<{ error: string }>(
      "POST",
      `/api/inspirations/${inspirationId}/revisits`,
      { eventType: "detail_opened" },
    );

    expect(res.status).toBe(404);
    expect(await countRevisitEvents(inspirationId)).toBe(0);
  });

  it("returns 400 for invalid revisit event payloads", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "invalid revisit payload target" },
    );
    expect(created.status).toBe(201);
    const inspirationId = created.body.inspiration.id;

    const invalidEvent = await client.json<ValidationErrorResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/revisits`,
      { eventType: "list_rendered" },
    );
    expect(invalidEvent.status).toBe(400);
    expect(invalidEvent.body.error).toMatch(/invalid revisit payload/i);

    const missingEvent = await client.json<ValidationErrorResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/revisits`,
      {},
    );
    expect(missingEvent.status).toBe(400);
    expect(missingEvent.body.error).toMatch(/invalid revisit payload/i);
    expect(await countRevisitEvents(inspirationId)).toBe(0);
  });

  it("returns displayed WOW score in the response patch instead of persisted core WOW", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "old note with a displayed score delta" },
    );
    expect(created.status).toBe(201);
    const inspirationId = created.body.inspiration.id;
    const createdAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    await getDb()
      .update(inspirations)
      .set({ createdAt } as Partial<typeof inspirations.$inferInsert>)
      .where(eq(inspirations.id, inspirationId));

    const res = await client.json<RevisitResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/revisits`,
      { eventType: "detail_returned" },
    );
    expect(res.status).toBe(201);
    expect(res.body.inspiration).not.toBeNull();

    const [stored] = await getDb()
      .select({ importanceScore: inspirations.importanceScore, wowScore: inspirations.wowScore })
      .from(inspirations)
      .where(eq(inspirations.id, inspirationId));
    expect(stored).toBeTruthy();

    const expectedDisplayed = calculateDisplayedInspirationScore({
      coreWowScore: stored!.wowScore,
      createdAt,
      now: new Date(res.body.revisit.createdAt),
    });
    expect(res.body.inspiration!.importanceScore).toBe(stored!.importanceScore);
    expect(res.body.inspiration!.wowScore).toBe(expectedDisplayed);
    expect(res.body.inspiration!.wowScore).not.toBe(stored!.wowScore);
  });

  it("GET /api/inspirations does not create revisit events or inflate stored scores", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "list reads are not revisits" },
    );
    expect(created.status).toBe(201);
    const inspirationId = created.body.inspiration.id;

    const [before] = await getDb()
      .select({ importanceScore: inspirations.importanceScore, wowScore: inspirations.wowScore })
      .from(inspirations)
      .where(eq(inspirations.id, inspirationId));
    expect(before).toBeTruthy();
    expect(await countRevisitEvents(inspirationId)).toBe(0);

    const list = await client.get<ListInspirationsResponse>("/api/inspirations");
    expect(list.status).toBe(200);
    expect(list.body.inspirations.some((row) => row.id === inspirationId)).toBe(true);

    const [after] = await getDb()
      .select({ importanceScore: inspirations.importanceScore, wowScore: inspirations.wowScore })
      .from(inspirations)
      .where(eq(inspirations.id, inspirationId));
    expect(after).toEqual(before);
    expect(await countRevisitEvents(inspirationId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Authentication required — every route in this namespace must reject an
// anonymous request before it touches the DB.
// ---------------------------------------------------------------------------

describe("authentication required", () => {
  it("POST /api/inspirations returns 401 when no session is presented", async () => {
    const res = await apiRequest("/api/inspirations", {
      method: "POST",
      body: { text: "anonymous" },
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/inspirations returns 401 when no session is presented", async () => {
    const res = await apiRequest("/api/inspirations", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("GET /api/inspirations/:id/reflections returns 401 when no session is presented", async () => {
    // The route checks authn BEFORE parsing the path, so a syntactically
    // valid uuid produces 401, not 400, on the unauthenticated path. We use
    // a real-looking uuid to make the assertion narrow-scoped.
    const res = await apiRequest(
      "/api/inspirations/00000000-0000-0000-0000-000000000000/reflections",
      { method: "GET" },
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/inspirations rejects a malformed bearer token with 401", async () => {
    // Even with an Authorization header present, an unparsable token must
    // not be accepted. Guards against a regression where the middleware
    // accidentally treats absence-of-throw as "ok".
    const res = await apiRequest("/api/inspirations", {
      method: "POST",
      headers: { Authorization: "Bearer not-a-real-jwt" },
      body: { text: "should not save" },
    });
    expect(res.status).toBe(401);
  });

  it("an authenticated request still succeeds (sanity counterpart)", async () => {
    // Pair every "401 without auth" assertion with at least one positive
    // case so a regression that 401s every request — including the valid
    // ones — doesn't slip past as a green test.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.get<ListInspirationsResponse>("/api/inspirations");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/inspirations/:id — update / partial update
// ---------------------------------------------------------------------------
//
// Sub-AC 13.3.3 mandates coverage of:
//   - Successful updates (full payload swap)
//   - Partial updates    (one field at a time, others untouched)
//   - 404 on missing resources
//   - 401 on unauthenticated calls (covered in the namespace section below)
//
// Why we drive the live Hono `app` here too
// -----------------------------------------
// Same rationale as the create-path tests above: stubbing Drizzle replaces
// the most failure-prone parts of the contract — the `WHERE id = :id AND
// user_id = caller` predicate, the zod-strip of forged client fields,
// `.returning()` semantics — with hand-written mocks that drift from
// production. We round-trip through the real Hono app + getDb() pinned to
// Neon so we know the route + schema actually meet the seed's
// `data_isolation` evaluation principle.

describe("PATCH /api/inspirations/:id — successful updates", () => {
  it("updates every editable field in one PATCH (text, kind, category) and bumps updatedAt", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    // Seed an inspiration we can edit. We capture the original `updatedAt`
    // so the assertion below proves the PATCH actually bumps it (rather
    // than the row simply being recently created).
    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before edit", kind: "note", category: 1 },
    );
    expect(created.status).toBe(201);
    const original = created.body.inspiration;
    const originalUpdatedAt = new Date(original.updatedAt).getTime();

    // Sleep ~10ms to make the timestamp comparison strictly distinct on
    // hosts where Date.now() ticks coarsely. Without this, a fast PATCH
    // on the same millisecond would race the "updatedAt > original" check.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${original.id}`,
      { text: "after edit", kind: "link", category: 7 },
    );

    expect(res.status).toBe(200);
    const row = res.body.inspiration;
    // Identity preserved — PATCH is not allowed to re-mint the id.
    expect(row.id).toBe(original.id);
    // Tenant scope preserved — userId never moves to another tenant.
    expect(row.userId).toBe(fixture.user.id);
    // Edited fields written through.
    expect(row.text).toBe("after edit");
    expect(row.kind).toBe("link");
    expect(row.category).toBe(7);
    // createdAt is immutable across edits; updatedAt MUST tick forward so
    // the SPA can use it as a freshness signal.
    expect(row.createdAt).toBe(original.createdAt);
    expect(new Date(row.updatedAt).getTime()).toBeGreaterThan(
      originalUpdatedAt,
    );
    // Cluster / classifiedAt remain server-managed — PATCH must not touch
    // them. Both stay null on a row whose classifier hasn't run yet.
    expect(row.cluster).toBeNull();
    expect(row.classifiedAt).toBeNull();

    // Round-trip assertion: the edit really landed in Postgres, not just
    // in the response payload.
    const dbRows = await getDb()
      .select({
        text: inspirations.text,
        kind: inspirations.kind,
        category: inspirations.category,
      })
      .from(inspirations)
      .where(eq(inspirations.id, original.id));
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.text).toBe("after edit");
    expect(dbRows[0]!.kind).toBe("link");
    expect(dbRows[0]!.category).toBe(7);
  });

  it("trims whitespace on text just like the create path", async () => {
    // Drift between create-path and update-path normalisation is a classic
    // bug source (a user edits a row to fix a typo and ends up with leading
    // spaces because the PATCH schema forgot `.trim()`). Lock the parity in.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "original" },
    );
    expect(created.status).toBe(201);

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { text: "  trimmed value  " },
    );

    expect(res.status).toBe(200);
    expect(res.body.inspiration.text).toBe("trimmed value");
  });

  it("ignores a forged userId in the request body — auth context wins", async () => {
    // The schema is .strict() in spirit (no `userId` field declared) so a
    // body-supplied `userId` is silently dropped. Lock the regression here
    // so a future schema-loosening bug surfaces immediately rather than as
    // a tenant-isolation incident in production.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before" },
    );
    expect(created.status).toBe(201);

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      {
        text: "after",
        userId: "00000000-0000-0000-0000-000000000000",
        user_id: "00000000-0000-0000-0000-000000000000",
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.inspiration.userId).toBe(fixture.user.id);
    expect(res.body.inspiration.userId).not.toBe(
      "00000000-0000-0000-0000-000000000000",
    );
  });

  it("ignores a body-supplied cluster / classifiedAt — only the worker may write those", async () => {
    // Cluster classification is async (AC 10/11). If a client could pin
    // their own cluster value via PATCH they would skip Gemini entirely
    // and break the seed's `async_correctness` evaluation principle.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "still pending classification" },
    );
    expect(created.status).toBe(201);
    expect(created.body.inspiration.cluster).toBeNull();

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      {
        text: "edited text",
        cluster: "outlier",
        classifiedAt: new Date().toISOString(),
      },
    );

    expect(res.status).toBe(200);
    // The text edit landed.
    expect(res.body.inspiration.text).toBe("edited text");
    // The forged cluster + classifiedAt were stripped by zod.
    expect(res.body.inspiration.cluster).toBeNull();
    expect(res.body.inspiration.classifiedAt).toBeNull();
  });
});

describe("PATCH /api/inspirations/:id — partial updates", () => {
  it("updates only `text` when only `text` is supplied; kind/category are preserved", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before", kind: "note", category: 4 },
    );
    expect(created.status).toBe(201);

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { text: "after-only-text" },
    );

    expect(res.status).toBe(200);
    expect(res.body.inspiration.text).toBe("after-only-text");
    // Unspecified fields MUST be left exactly as they were.
    expect(res.body.inspiration.kind).toBe("note");
    expect(res.body.inspiration.category).toBe(4);
  });

  it("updates only `kind` when only `kind` is supplied; text/category are preserved", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before", kind: "note", category: 9 },
    );
    expect(created.status).toBe(201);

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { kind: "image" },
    );

    expect(res.status).toBe(200);
    expect(res.body.inspiration.text).toBe("before");
    expect(res.body.inspiration.kind).toBe("image");
    expect(res.body.inspiration.category).toBe(9);
  });

  it("updates only `category` when only `category` is supplied; text/kind are preserved", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before", kind: "note", category: 1 },
    );
    expect(created.status).toBe(201);

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { category: 42 },
    );

    expect(res.status).toBe(200);
    expect(res.body.inspiration.text).toBe("before");
    expect(res.body.inspiration.kind).toBe("note");
    expect(res.body.inspiration.category).toBe(42);
  });

  it("clears `kind` when null is explicitly passed", async () => {
    // Distinguish "omit the key (leave alone)" from "pass null (clear)".
    // Both are valid PATCH semantics and the route MUST honour the
    // distinction or the SPA can never erase a previously-set kind.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before", kind: "note", category: 3 },
    );
    expect(created.status).toBe(201);
    expect(created.body.inspiration.kind).toBe("note");

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { kind: null },
    );

    expect(res.status).toBe(200);
    expect(res.body.inspiration.kind).toBeNull();
    // category was not in the payload → preserved.
    expect(res.body.inspiration.category).toBe(3);
  });

  it("clears `category` when null is explicitly passed", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before", kind: "note", category: 5 },
    );
    expect(created.status).toBe(201);

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { category: null },
    );

    expect(res.status).toBe(200);
    expect(res.body.inspiration.kind).toBe("note");
    expect(res.body.inspiration.category).toBeNull();
  });

  it("rejects an empty PATCH body (no fields supplied) with 400", async () => {
    // A no-op PATCH would silently bump updated_at, misleading any
    // freshness-sorted view. Reject loudly so a buggy SPA call surfaces.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before" },
    );
    expect(created.status).toBe(201);

    const res = await client.json<ValidationErrorResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      {},
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid inspiration payload/i);
  });

  it("rejects an empty/whitespace-only `text` with 400", async () => {
    // Same rule as the create path — `text` is NOT NULL in the schema, so
    // accepting "" or "   " here would either fail at INSERT time with a
    // confusing 500 or silently store whitespace.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before" },
    );
    expect(created.status).toBe(201);

    const res = await client.json<ValidationErrorResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { text: "   \t  \n  " },
    );

    expect(res.status).toBe(400);
    expect(res.body.details?.text?.[0]).toMatch(/required/i);
  });

  it("rejects a non-integer `category` with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before" },
    );
    expect(created.status).toBe(201);

    const res = await client.json<ValidationErrorResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { category: 2.5 },
    );

    expect(res.status).toBe(400);
    expect(res.body.details?.category?.[0]).toMatch(/integer/i);
  });
});

describe("PATCH /api/inspirations/:id — 404 on missing resources", () => {
  it("returns 404 for an unknown (well-formed) uuid", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    // A syntactically valid uuid that almost certainly doesn't exist. The
    // contract is 404 + JSON error body — not 500, not silent 200.
    const res = await client.json<{ error: string }>(
      "PATCH",
      "/api/inspirations/00000000-0000-0000-0000-000000000000",
      { text: "ghost" },
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 (not 403) when patching another user's id (no enumeration)", async () => {
    // Cross-tenant id MUST collapse to 404 so this endpoint cannot be used
    // to enumerate uuids that exist for other tenants. Same convention as
    // POST /:id/reflections, GET /:id/reflections, and DELETE /:id.
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);

    const aliceCreate = await authedClient(alice).json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "alice's private save", kind: "note", category: 1 },
    );
    expect(aliceCreate.status).toBe(201);
    const aliceInspirationId = aliceCreate.body.inspiration.id;
    const aliceOriginalText = aliceCreate.body.inspiration.text;

    // Bob attempts to PATCH Alice's row.
    const bobAttempt = await authedClient(bob).json<{ error: string }>(
      "PATCH",
      `/api/inspirations/${aliceInspirationId}`,
      { text: "pwned by bob" },
    );
    expect(bobAttempt.status).toBe(404);

    // And Alice's row is unchanged in the DB — no covert mutation slipped
    // through. This is the "data_isolation" evaluation principle in action.
    const dbRows = await getDb()
      .select({ text: inspirations.text, userId: inspirations.userId })
      .from(inspirations)
      .where(eq(inspirations.id, aliceInspirationId));
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.userId).toBe(alice.user.id);
    expect(dbRows[0]!.text).toBe(aliceOriginalText);
  });

  it("returns 400 for a malformed uuid (path validation precedes lookup)", async () => {
    // Reject up-front rather than letting Postgres complain about
    // "invalid input syntax for type uuid" — that would surface as 500.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<{ error: string }>(
      "PATCH",
      "/api/inspirations/not-a-uuid",
      { text: "anything" },
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid inspiration id/i);
  });

  it("returns 404 when patching an id that was just deleted (idempotency invariant)", async () => {
    // Order-of-operations invariant: delete-then-patch must 404, not 200.
    // A regression that returned 200 here would either resurrect the row
    // or silently no-op while pretending success.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "to be deleted then patched" },
    );
    expect(created.status).toBe(201);

    const del = await client.delete(
      `/api/inspirations/${created.body.inspiration.id}`,
    );
    expect(del.status).toBe(200);

    const res = await client.json<{ error: string }>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { text: "post-delete edit" },
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/inspirations/:id — deletion
// ---------------------------------------------------------------------------
//
// Exercises the same five buckets as the PATCH section (success, idempotency
// on re-delete, cross-tenant 404, malformed-id 400). The cascade behaviour
// (attachments + reflections removed by FK) is asserted via a follow-up
// SELECT against the DB so a future migration that weakens the cascade
// surfaces here, not in production.

describe("DELETE /api/inspirations/:id — successful deletion", () => {
  it("returns 200 with the deleted id and removes the row from the DB", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "to be deleted" },
    );
    expect(created.status).toBe(201);
    const targetId = created.body.inspiration.id;

    const res = await client.delete<{ id: string }>(
      `/api/inspirations/${targetId}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(targetId);

    // The row is really gone from Postgres, not just hidden by a soft
    // delete flag the route swallowed without persisting.
    const dbRows = await getDb()
      .select({ id: inspirations.id })
      .from(inspirations)
      .where(eq(inspirations.id, targetId));
    expect(dbRows).toHaveLength(0);
  });

  it("removes the row from the GET /api/inspirations list immediately", async () => {
    // The user-visible contract: after a successful delete, the row is
    // gone from the history sidebar on the next list fetch. No `?include
    // _deleted` flag, no soft-delete leakage.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const a = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "row-a-keep" },
    );
    const b = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "row-b-delete" },
    );
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const del = await client.delete(`/api/inspirations/${b.body.inspiration.id}`);
    expect(del.status).toBe(200);

    const list = await client.get<ListInspirationsResponse>("/api/inspirations");
    expect(list.status).toBe(200);
    const ids = list.body.inspirations.map((r) => r.id);
    expect(ids).toContain(a.body.inspiration.id);
    expect(ids).not.toContain(b.body.inspiration.id);
  });

  it("cascades to reflections (FK ON DELETE CASCADE)", async () => {
    // The `reflections.inspiration_id` FK is `ON DELETE CASCADE` in
    // migration 0003. Drop the inspiration → all reflections under it
    // must vanish in the same transaction. Asserting this in a test (not
    // just trusting the migration) catches a future schema change that
    // weakens the cascade and would otherwise leave orphans.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "parent of reflections" },
    );
    expect(created.status).toBe(201);
    const inspirationId = created.body.inspiration.id;

    // Attach two reflections so we can prove BOTH go away (not just the
    // first one a buggy `LIMIT 1` cascade might catch).
    const r1 = await client.json<ReflectionResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/reflections`,
      { question: "first reflection?" },
    );
    const r2 = await client.json<ReflectionResponse>(
      "POST",
      `/api/inspirations/${inspirationId}/reflections`,
      { question: "second reflection?" },
    );
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    // Delete the parent.
    const del = await client.delete(`/api/inspirations/${inspirationId}`);
    expect(del.status).toBe(200);

    // Reflections endpoint now 404s the parent — same idempotent
    // not-found shape as a never-existing id.
    const after = await client.get(
      `/api/inspirations/${inspirationId}/reflections`,
    );
    expect(after.status).toBe(404);
  });
});

describe("DELETE /api/inspirations/:id — 404 on missing resources", () => {
  it("returns 404 for an unknown (well-formed) uuid", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.delete<{ error: string }>(
      "/api/inspirations/00000000-0000-0000-0000-000000000000",
    );

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 404 on re-delete (idempotent from caller's view)", async () => {
    // The first DELETE removes the row. The second DELETE finds nothing,
    // returns 404 — NOT 500. From the SPA's perspective the row is
    // already gone either way, so the optimistic-remove UX is unchanged.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "double-delete-me" },
    );
    expect(created.status).toBe(201);
    const targetId = created.body.inspiration.id;

    const first = await client.delete(`/api/inspirations/${targetId}`);
    expect(first.status).toBe(200);

    const second = await client.delete<{ error: string }>(
      `/api/inspirations/${targetId}`,
    );
    expect(second.status).toBe(404);
  });

  it("returns 404 (not 403) when deleting another user's id (no enumeration)", async () => {
    // Cross-tenant attempt MUST 404 — a 403 would leak the existence of
    // the row to the attacker, allowing them to enumerate other tenants'
    // uuids. And the row must remain in the DB owned by the original
    // user (no covert deletion slipped through).
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);

    const aliceCreate = await authedClient(alice).json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "alice's private save" },
    );
    expect(aliceCreate.status).toBe(201);
    const aliceInspirationId = aliceCreate.body.inspiration.id;

    const bobAttempt = await authedClient(bob).delete<{ error: string }>(
      `/api/inspirations/${aliceInspirationId}`,
    );
    expect(bobAttempt.status).toBe(404);

    // Alice's row survived bob's attempt unchanged.
    const dbRows = await getDb()
      .select({ id: inspirations.id, userId: inspirations.userId })
      .from(inspirations)
      .where(eq(inspirations.id, aliceInspirationId));
    expect(dbRows).toHaveLength(1);
    expect(dbRows[0]!.userId).toBe(alice.user.id);
  });

  it("returns 400 for a malformed uuid (path validation precedes lookup)", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.delete<{ error: string }>(
      "/api/inspirations/not-a-uuid",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid inspiration id/i);
  });
});

// ---------------------------------------------------------------------------
// Authentication required — every PATCH and DELETE must reject an anonymous
// request before it touches the DB. We mirror the structure of the namespace
// section above so a regression that loosens the middleware on PATCH/DELETE
// surfaces here, not in production.
// ---------------------------------------------------------------------------

describe("authentication required — PATCH / DELETE", () => {
  it("PATCH /api/inspirations/:id returns 401 when no session is presented", async () => {
    // Use a real-looking uuid so the assertion is narrow-scoped: the
    // route checks authn BEFORE parsing the path/body, so the response
    // is 401 even with a valid id and body shape.
    const res = await apiRequest(
      "/api/inspirations/00000000-0000-0000-0000-000000000000",
      {
        method: "PATCH",
        body: { text: "anonymous edit" },
      },
    );
    expect(res.status).toBe(401);
  });

  it("DELETE /api/inspirations/:id returns 401 when no session is presented", async () => {
    const res = await apiRequest(
      "/api/inspirations/00000000-0000-0000-0000-000000000000",
      { method: "DELETE" },
    );
    expect(res.status).toBe(401);
  });

  it("PATCH /api/inspirations/:id rejects a malformed bearer token with 401", async () => {
    // Even with an Authorization header present, an unparsable token must
    // not be accepted. Guards against a regression where the middleware
    // accidentally treats absence-of-throw as "ok".
    const res = await apiRequest(
      "/api/inspirations/00000000-0000-0000-0000-000000000000",
      {
        method: "PATCH",
        headers: { Authorization: "Bearer not-a-real-jwt" },
        body: { text: "should not save" },
      },
    );
    expect(res.status).toBe(401);
  });

  it("DELETE /api/inspirations/:id rejects a malformed bearer token with 401", async () => {
    const res = await apiRequest(
      "/api/inspirations/00000000-0000-0000-0000-000000000000",
      {
        method: "DELETE",
        headers: { Authorization: "Bearer not-a-real-jwt" },
      },
    );
    expect(res.status).toBe(401);
  });

  it("an authenticated PATCH still succeeds (sanity counterpart)", async () => {
    // Pair the 401 assertions with at least one positive case so a
    // regression that 401s every PATCH — including the valid ones —
    // doesn't slip past as a green test.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "before" },
    );
    expect(created.status).toBe(201);

    const res = await client.json<CreateInspirationResponse>(
      "PATCH",
      `/api/inspirations/${created.body.inspiration.id}`,
      { text: "after" },
    );
    expect(res.status).toBe(200);
    expect(res.body.inspiration.text).toBe("after");
  });

  it("an authenticated DELETE still succeeds (sanity counterpart)", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const created = await client.json<CreateInspirationResponse>(
      "POST",
      "/api/inspirations",
      { text: "to be deleted" },
    );
    expect(created.status).toBe(201);

    const res = await client.delete<{ id: string }>(
      `/api/inspirations/${created.body.inspiration.id}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.inspiration.id);
  });
});
