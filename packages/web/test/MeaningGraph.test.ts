import { describe, expect, it } from "vitest";

import {
  MEANING_GRAPH_COPY,
  filterMeaningGraphNodes,
  meaningGraphDragModeSummary,
  relationshipLabel,
  relationshipSummary,
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
    memory: {
      state: "active",
      firstSeenAt: "2026-05-01T00:00:00.000Z",
      lastSeenAt: "2026-05-01T00:00:00.000Z",
      reinforcementCount: 1,
      recentReinforcementCount: 1,
      currentWeight: 112,
      confidence: 80,
      decay: 0,
      supportingSignalIds: ["signal-1"],
      movementScore: 180,
    },
    qualityIndicators: [],
    relatedTopOfMindNotes: [],
    feedback: [],
    evidence: [],
    ...input,
  };
}

describe("meaning graph Korean admin copy", () => {
  it("localizes the admin graph strings that previously leaked visible English", () => {
    const koreanVisibleCopy = [
      MEANING_GRAPH_COPY["ko-KR"].graphEyebrow,
      MEANING_GRAPH_COPY["ko-KR"].rebuildConfirmTitle,
      MEANING_GRAPH_COPY["ko-KR"].rebuildConfirmBody,
      MEANING_GRAPH_COPY["ko-KR"].noSelectionIntro,
      MEANING_GRAPH_COPY["ko-KR"].recentSignalsEyebrow,
      MEANING_GRAPH_COPY["ko-KR"].recentSignalsIntro,
      MEANING_GRAPH_COPY["ko-KR"].allTypes,
      MEANING_GRAPH_COPY["ko-KR"].confidence,
      MEANING_GRAPH_COPY["ko-KR"].noRecentSignals,
    ].join(" ");

    expect(koreanVisibleCopy).not.toMatch(/context graph|The graph above|recent signals|Newest saves|All types|Confidence|No recent signals/i);
    expect(koreanVisibleCopy).toContain("맥락 그래프");
    expect(MEANING_GRAPH_COPY["en-US"].recentSignalsIntro).toContain("context graph");
  });

  it("localizes helper-rendered drag and relationship copy in Korean mode", () => {
    const edge = {
      kind: "points_to",
      sourceLabel: "공개 제작 공간",
      targetLabel: "야망 있는 동료",
    };

    expect(meaningGraphDragModeSummary(true, "ko-KR")).toBe(
      "개별 노드 이동이 켜져 있습니다. 옮긴 노드는 그래프를 새로고침할 때까지 위치가 유지됩니다.",
    );
    expect(meaningGraphDragModeSummary(false, "ko-KR")).toBe("노드 이동이 꺼져 있습니다.");
    expect(relationshipLabel(edge, "ko-KR")).toBe("가리킴");
    expect(relationshipSummary(edge, "ko-KR")).toBe("공개 제작 공간 가리킴 야망 있는 동료");

    const renderedKoreanHelperCopy = [
      meaningGraphDragModeSummary(true, "ko-KR"),
      meaningGraphDragModeSummary(false, "ko-KR"),
      relationshipLabel(edge, "ko-KR"),
      relationshipSummary(edge, "ko-KR"),
    ].join(" ");

    expect(renderedKoreanHelperCopy).not.toMatch(
      /Individual node dragging|Node dragging is disabled|points to|supports|challenges|asks for|reactivates/i,
    );
  });

  it("preserves English helper copy for en-US admins", () => {
    const edge = {
      kind: "points_to",
      sourceLabel: "public building rooms",
      targetLabel: "ambitious peers",
    };

    expect(meaningGraphDragModeSummary(true, "en-US")).toContain("Individual node dragging is enabled");
    expect(meaningGraphDragModeSummary(false, "en-US")).toBe("Node dragging is disabled.");
    expect(relationshipLabel(edge, "en-US")).toBe("points to");
    expect(relationshipSummary(edge, "en-US")).toBe("public building rooms points to ambitious peers");
  });
});

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
        memoryState: "all",
        onlyRecentCorrections: false,
        minConfidence: 90,
      }).map((node) => node.id),
    ).toEqual(["place-1"]);
  });

  it("filters by memory state and recent corrections across graph claims and post-its", () => {
    const nodes = [
      graphNode({
        id: "corrected-post-it",
        label: "rooms that changed after feedback",
        memory: {
          ...graphNode({ id: "tmp", label: "tmp" }).memory,
          state: "reactivated",
        },
        relatedTopOfMindNotes: [
          {
            id: "note-1",
            title: "I need rooms where honest building feels normal.",
            why: "This may matter now.",
            score: 88,
            ambitionDimension: "place",
            ambientSignal: "I need rooms where honest building feels normal.",
            matchedEnvironment: "Rooms with honest builders.",
            antiEnvironment: "Rooms that reward performance.",
            evidenceRationale: "Supported by saved signals.",
            rejectedAlternativeInterpretation: "The shallow read would call this startups.",
            whyNow: "A pattern came back.",
            changedRecently: "One recent signal reinforced this.",
            feedback: [
              {
                id: "feedback-1",
                targetType: "top_of_mind_note",
                value: "partly",
                emotionLabel: null,
                correctionText: "Make this about courage, not productivity.",
                source: "user",
                createdAt: new Date().toISOString(),
              },
            ],
            qualityIndicators: [],
            createdAt: "2026-05-01T00:00:00.000Z",
          },
        ],
      }),
      graphNode({
        id: "active-no-correction",
        label: "active but unchanged",
      }),
    ];

    expect(
      filterMeaningGraphNodes({
        nodes,
        search: "",
        contextType: "all",
        ambitionDimension: "all",
        status: "all",
        memoryState: "reactivated",
        onlyRecentCorrections: true,
        minConfidence: 0,
      }).map((node) => node.id),
    ).toEqual(["corrected-post-it"]);
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
