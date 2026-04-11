import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFindConnectionAnalysisInspirationArgs,
  buildUpsertConnectionAnalysisArgs,
} from "../apps/web/src/jobs/connection-analysis-persistence.ts";

test("buildFindConnectionAnalysisInspirationArgs scopes the source lookup to the owning user and excludes soft-deleted inspirations", () => {
  assert.deepEqual(
    buildFindConnectionAnalysisInspirationArgs("user_capture", "insp_new"),
    {
      select: {
        embedding: true,
        id: true,
        rawContent: true,
      },
      where: {
        deletedAt: null,
        id: "insp_new",
        userId: "user_capture",
      },
    },
  );
});

test("buildUpsertConnectionAnalysisArgs persists directional connection rows with retry-safe upsert keys", () => {
  const surfacedAt = new Date("2026-04-11T02:00:00.000Z");

  assert.deepEqual(
    buildUpsertConnectionAnalysisArgs({
      explanation: "Both notes focus on durable capture workflows.",
      similarityScore: 0.91,
      sourceId: "insp_new",
      surfacedAt,
      targetId: "insp_prior",
      userId: "user_capture",
    }),
    {
      create: {
        explanation: "Both notes focus on durable capture workflows.",
        similarityScore: 0.91,
        sourceId: "insp_new",
        surfacedAt,
        targetId: "insp_prior",
        userId: "user_capture",
      },
      update: {
        explanation: "Both notes focus on durable capture workflows.",
        similarityScore: 0.91,
        surfacedAt,
      },
      where: {
        sourceId_targetId: {
          sourceId: "insp_new",
          targetId: "insp_prior",
        },
      },
    },
  );
});
