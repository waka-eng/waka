import { describe, expect, it } from "vitest";

import {
  filterMeaningGraphNodes,
  meaningGraphDragModeSummary,
  rebuildJobResult,
  updateManualNodePosition,
} from "../src/pages/MeaningGraph";
import type { ApiMeaningGraphNode, ApiMeaningGraphRebuildJob } from "../src/lib/api";

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

function graphNode(input: Partial<ApiMeaningGraphNode> & Pick<ApiMeaningGraphNode, "id" | "label">): ApiMeaningGraphNode {
  return {
    type: "theme",
    contextType: "theme",
    ambitionDimension: "work",
    description: "",
    status: "active",
    source: "meaning_graph_writer",
    weight: 100,
    confidence: 80,
    evidenceCount: 1,
    firstSeenAt: "2026-05-01T00:00:00.000Z",
    lastReinforcedAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
    relatedTopOfMindNotes: [],
    feedback: [],
    evidence: [],
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

describe("filterMeaningGraphNodes", () => {
  it("filters context nodes by ambition dimension, type, confidence, status, and searchable evidence", () => {
    const nodes = [
      graphNode({
        id: "place-1",
        label: "rooms where builders make in public",
        contextType: "environment",
        ambitionDimension: "place",
        confidence: 91,
        evidence: [
          {
            inspirationId: "signal-1",
            packetId: "packet-1",
            reason: "The saved signal points to public building rooms.",
            weight: 72,
            confidence: 90,
            source: "meaning_graph_writer",
            preview: "make in public with ambitious peers",
            packetPreview: "waka.signal_packet.v1",
            tokenEstimate: 18,
            inspirationCreatedAt: "2026-05-01T00:00:00.000Z",
            createdAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      }),
      graphNode({
        id: "taste-1",
        label: "polished tools",
        contextType: "aesthetic",
        ambitionDimension: "taste",
        confidence: 70,
      }),
      graphNode({
        id: "stale-1",
        label: "old hypothesis",
        contextType: "hypothesis",
        ambitionDimension: "next_experiment",
        status: "stale",
        confidence: 95,
      }),
    ];

    expect(
      filterMeaningGraphNodes({
        nodes,
        search: "public",
        contextType: "environment",
        ambitionDimension: "place",
        status: "active",
        minConfidence: 90,
      }).map((node) => node.id),
    ).toEqual(["place-1"]);
  });
});

describe("context graph drag helpers", () => {
  it("stores only the dragged node position", () => {
    const current = new Map([
      ["node-a", { x: 10, y: 20 }],
      ["node-b", { x: 30, y: 40 }],
    ]);

    const next = updateManualNodePosition(current, "node-a", { x: 80, y: 90 });

    expect(next.get("node-a")).toEqual({ x: 80, y: 90 });
    expect(next.get("node-b")).toEqual({ x: 30, y: 40 });
    expect(current.get("node-a")).toEqual({ x: 10, y: 20 });
    expect(meaningGraphDragModeSummary(true)).toContain("Individual node dragging is enabled");
  });
});
