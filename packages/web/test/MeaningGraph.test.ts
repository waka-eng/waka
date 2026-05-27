import { describe, expect, it } from "vitest";

import { rebuildJobResult } from "../src/pages/MeaningGraph";
import type { ApiMeaningGraphRebuildJob } from "../src/lib/api";

function rebuildJob(
  input: Partial<ApiMeaningGraphRebuildJob> & {
    payload: ApiMeaningGraphRebuildJob["payload"];
  },
): ApiMeaningGraphRebuildJob {
  return {
    id: "job-1",
    type: "meaning_graph_rebuild",
    status: "succeeded",
    payload: input.payload,
    attempts: 1,
    maxAttempts: 3,
    runAfter: null,
    lockedAt: null,
    lastError: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    ...input,
  };
}

describe("rebuildJobResult", () => {
  it("derives the completed inspiration count from durable rebuild progress payloads", () => {
    expect(
      rebuildJobResult(
        rebuildJob({
          payload: {
            requestedByUserId: "user-1",
            phase: "completed",
            totalInspirations: 7,
            processedInspirations: 7,
            nodesTouched: 12,
            evidenceTouched: 14,
            edgesTouched: 9,
            completedAt: "2026-05-01T00:01:00.000Z",
          },
        }),
      ),
    ).toEqual({
      inspirations: 7,
      nodesTouched: 12,
      evidenceTouched: 14,
      edgesTouched: 9,
    });
  });

  it("keeps explicit API result inspiration counts when present", () => {
    expect(
      rebuildJobResult(
        rebuildJob({
          payload: {
            inspirations: 3,
            totalInspirations: 7,
            processedInspirations: 7,
            nodesTouched: 5,
            evidenceTouched: 6,
            edgesTouched: 4,
          },
        }),
      ),
    ).toMatchObject({ inspirations: 3 });
  });

  it("does not surface a completed result for active rebuild jobs", () => {
    expect(
      rebuildJobResult(
        rebuildJob({
          status: "running",
          payload: {
            totalInspirations: 7,
            processedInspirations: 2,
            nodesTouched: 5,
            evidenceTouched: 6,
            edgesTouched: 4,
          },
        }),
      ),
    ).toBeNull();
  });
});
