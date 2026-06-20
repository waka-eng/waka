import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";

import { FloatingEdge } from "../components/FloatingEdge";
import { useAuth } from "../lib/auth-context";
import { normalizeSupportedLocale, readStoredLocale, type SupportedLocale } from "../lib/locales";
import {
  fetchMeaningGraph,
  fetchMeaningGraphRebuildJob,
  formatMeaningGraphRebuildError,
  rebuildMeaningGraph,
  type ApiMeaningGraph,
  type ApiMeaningGraphEdge,
  type ApiMeaningGraphNode,
  type ApiMeaningGraphRecentInspiration,
  type ApiMeaningGraphRebuildJob,
  type ApiMeaningGraphRebuildResult,
} from "../lib/api";

interface SimNode extends SimulationNodeDatum {
  id: string;
  weight: number;
}

interface MeaningNodeData {
  type: string;
  contextType: string;
  ambitionDimension: AmbitionDimension;
  label: string;
  description: string;
  weight: number;
  evidenceCount: number;
  isFocus: boolean;
  fade: boolean;
}

const NODE_WIDTH = 238;
const NODE_HEIGHT = 96;
const MAX_VISIBLE_NODES = 34;
const MAX_VISIBLE_EDGES = 72;
const REBUILD_POLL_MS = 2_500;

const TYPE_ORDER = [
  "theme",
  "value",
  "person",
  "environment",
  "aesthetic",
  "tension",
  "project",
  "open_question",
  "hypothesis",
];

const AMBITION_DIMENSIONS = [
  "place",
  "people",
  "work",
  "taste",
  "identity",
  "rejection",
  "next_experiment",
] as const;

type AmbitionDimension = (typeof AMBITION_DIMENSIONS)[number];

const MEMORY_STATES = [
  "emerging",
  "active",
  "fading",
  "dormant",
  "reactivated",
  "contradicted",
  "needs_testing",
] as const;

type MemoryStateFilter = (typeof MEMORY_STATES)[number];

const MEMORY_LABEL: Record<MemoryStateFilter, string> = {
  emerging: "emerging",
  active: "active",
  fading: "fading",
  dormant: "dormant",
  reactivated: "reactivated",
  contradicted: "contradicted",
  needs_testing: "needs testing",
};

const TYPE_LABEL: Record<string, string> = {
  theme: "theme",
  value: "value",
  person: "person",
  aesthetic: "aesthetic",
  tension: "tension",
  project: "project",
  open_question: "open question",
  hypothesis: "hypothesis",
  environment: "environment",
  question: "question",
  desire: "desire",
  life_direction: "life direction",
  person_archetype: "person",
};

const AMBITION_LABEL: Record<AmbitionDimension, string> = {
  place: "place",
  people: "people",
  work: "work",
  taste: "taste",
  identity: "identity",
  rejection: "rejection",
  next_experiment: "next experiment",
};

type ContextTypeLabelMap = Record<string, string>;
type AmbitionLabelMap = Record<AmbitionDimension, string>;
type MemoryStateLabelMap = Record<MemoryStateFilter, string>;

const EDGE_KIND_KEYS = ["supports", "challenges", "points_to", "asks_for", "reactivates"] as const;
type EdgeKindKey = (typeof EDGE_KIND_KEYS)[number];
type EdgeKindLabels = Record<EdgeKindKey, string>;

interface MeaningGraphCopy {
  eyebrow: string;
  title: string;
  intro: string;
  rebuild: string;
  rebuilding: string;
  refresh: string;
  refreshing: string;
  graphEyebrow: string;
  graphTitle: string;
  graphIntro: string;
  graphSnapshotAria: string;
  graphFiltersAria: string;
  search: string;
  searchPlaceholder: string;
  nodeType: string;
  allTypes: string;
  ambition: string;
  allDimensions: string;
  status: string;
  allStatuses: string;
  active: string;
  stale: string;
  memory: string;
  allMemoryStates: string;
  confidence: string;
  recentCorrections: string;
  shown: (count: number) => string;
  dragEnabledSummary: string;
  dragDisabledSummary: string;
  edgeLabels: EdgeKindLabels;
  signals: (count: number) => string;
  contextNodes: (count: number) => string;
  relationshipEdges: (count: number) => string;
  graphEvidence: string;
  relationshipEvidence: string;
  contextNodeEvidence: string;
  selectGraphEntry: string;
  graphEntryReview: string;
  rebuildConfirmTitle: string;
  rebuildConfirmBody: string;
  startRebuild: string;
  cancel: string;
  rebuildQueuedPoll: string;
  loadingGraph: string;
  rebuildFinished: (signals: number, nodes: number, edges: number) => string;
  noGraphRowsTitle: string;
  noGraphRowsBody: string;
  noSelectionIntro: string;
  recentSignalsEyebrow: string;
  recentSignalsIntro: string;
  recentGraphEntrySummaryAria: string;
  addedNotes: (count: number) => string;
  addedRelationships: (count: number) => string;
  notAdded: (count: number) => string;
  processing: (count: number) => string;
  noRecentSignals: string;
  relationshipSummary: string;
  updated: string;
  evidenceSignals: string;
  type: string;
  ambitionDimension: string;
  memoryState: string;
  reinforcement: string;
  reinforcementTotalRecent: (total: number, recent: number) => string;
  decay: string;
  movementScore: string;
  memoryQuality: string;
  whyAmbitionTitle: string;
  whyAmbitionBody: (dimension: string) => string;
  relatedTopOfMindNotes: string;
  feedback: string;
  matchedRejected: (matched: string, rejected: string) => string;
  rejectedAlternateRead: string;
  feedbackSource: (source: string) => string;
  noDescription: string;
  noQualityWarnings: string;
  noSavedSignalEvidence: string;
  noActiveTopOfMind: string;
  noRejectedAlternative: string;
  noPostItFeedback: string;
  noNodeFeedback: string;
  noRelationshipEvidence: string;
  contextNodesHeading: string;
  relationshipEdgesHeading: string;
  noContextNodeProcessed: string;
  notFinishedProcessing: string;
  relationshipStoredEvidence: string;
  noRelationshipFromSave: string;
  noRelationshipYet: string;
  contextTypeLabels: ContextTypeLabelMap;
  ambitionLabels: AmbitionLabelMap;
  memoryStateLabels: MemoryStateLabelMap;
}

export const MEANING_GRAPH_COPY: Record<SupportedLocale, MeaningGraphCopy> = {
  "en-US": {
    eyebrow: "admin context dashboard",
    title: "Context dashboard",
    intro: "Monitor how saved signals become context nodes and relationship edges.",
    rebuild: "Rebuild graph",
    rebuilding: "Rebuilding graph...",
    refresh: "Refresh",
    refreshing: "Refreshing...",
    graphEyebrow: "context graph",
    graphTitle: "Graph",
    graphIntro: "Filter context claims, select evidence, and drag one node at a time while debugging.",
    graphSnapshotAria: "Context graph snapshot",
    graphFiltersAria: "Context graph filters",
    search: "Search",
    searchPlaceholder: "node, evidence, note, feedback",
    nodeType: "Node type",
    allTypes: "All types",
    ambition: "Ambition",
    allDimensions: "All dimensions",
    status: "Status",
    allStatuses: "All statuses",
    active: "Active",
    stale: "Stale",
    memory: "Memory",
    allMemoryStates: "All memory states",
    confidence: "Confidence",
    recentCorrections: "Recent corrections",
    shown: (count) => `${count} shown`,
    dragEnabledSummary:
      "Individual node dragging is enabled; moved nodes keep their positions until the graph is refreshed.",
    dragDisabledSummary: "Node dragging is disabled.",
    edgeLabels: {
      supports: "supports",
      challenges: "challenges",
      points_to: "points to",
      asks_for: "asks for",
      reactivates: "reactivates",
    },
    signals: (count) => `${count} signals`,
    contextNodes: (count) => `${count} context nodes`,
    relationshipEdges: (count) => `${count} relationship edges`,
    graphEvidence: "Graph evidence",
    relationshipEvidence: "Relationship evidence",
    contextNodeEvidence: "Context node evidence",
    selectGraphEntry: "Select a context node or relationship edge in the graph.",
    graphEntryReview: "Graph entry review",
    rebuildConfirmTitle: "Before you rebuild the context graph",
    rebuildConfirmBody:
      "Rebuild rereads your saved signals, regenerates missing signal packets, clears the current context graph rows for this account, then rebuilds context nodes, evidence, and relationship edges. It now runs as a background job, so the dashboard will poll progress and refresh itself when the job finishes. Starting another rebuild while one is active will return the existing job.",
    startRebuild: "Start rebuild",
    cancel: "Cancel",
    rebuildQueuedPoll: "Rebuild queued. This page will poll for progress.",
    loadingGraph: "Loading context graph...",
    rebuildFinished: (signals, nodes, edges) =>
      `Rebuild finished: ${signals} signals / ${nodes} notes / ${edges} edges. Dashboard refreshed.`,
    noGraphRowsTitle: "No graph rows yet",
    noGraphRowsBody: "Click rebuild after saving signals locally.",
    noSelectionIntro:
      "The graph above is the current context structure. Select a context node to see the signals behind it, or select a relationship edge to see what supports that connection.",
    recentSignalsEyebrow: "recent signals",
    recentSignalsIntro: "Newest saves and what they added to the context graph.",
    recentGraphEntrySummaryAria: "Recent graph entry summary",
    addedNotes: (count) => `${count} added notes`,
    addedRelationships: (count) => `${count} added relationships`,
    notAdded: (count) => `${count} not added`,
    processing: (count) => `${count} processing`,
    noRecentSignals: "No recent signals found.",
    relationshipSummary: "Relationship summary",
    updated: "updated",
    evidenceSignals: "evidence signals",
    type: "type",
    ambitionDimension: "ambition dimension",
    memoryState: "memory state",
    reinforcement: "reinforcement",
    reinforcementTotalRecent: (total, recent) => `${total} total / ${recent} recent`,
    decay: "decay",
    movementScore: "movement score",
    memoryQuality: "Memory and synthesis quality",
    whyAmbitionTitle: "Why this may matter for ambition",
    whyAmbitionBody: (dimension) =>
      `This node is currently treated as a ${dimension} signal: use the supporting saved signals, related Top of Mind notes, and feedback below to decide whether that read is useful or misleading.`,
    relatedTopOfMindNotes: "Related Top of Mind notes",
    feedback: "Feedback",
    matchedRejected: (matched, rejected) => `Matched: ${matched} Rejected: ${rejected}`,
    rejectedAlternateRead: "Rejected alternate read:",
    feedbackSource: (source) => `Feedback source: ${source}`,
    noDescription: "No description yet.",
    noQualityWarnings: "No quality warnings are attached to this context node.",
    noSavedSignalEvidence: "No saved-signal evidence is attached to this context node yet.",
    noActiveTopOfMind: "No active Top of Mind note is currently tied to this context node.",
    noRejectedAlternative: "No rejected alternative stored yet.",
    noPostItFeedback: "No user feedback has shaped this post-it yet.",
    noNodeFeedback: "No user feedback has been stored for this context node yet.",
    noRelationshipEvidence:
      "This relationship has stored evidence ids, but no recent matching signal is in the current feed.",
    contextNodesHeading: "Context nodes",
    relationshipEdgesHeading: "Relationship edges",
    noContextNodeProcessed: "No context node was created or reinforced from this save.",
    notFinishedProcessing: "This save has not finished processing yet.",
    relationshipStoredEvidence: "This save is stored as evidence for the relationship.",
    noRelationshipFromSave: "No relationship edge was created from this save.",
    noRelationshipYet: "No relationship edge yet.",
    contextTypeLabels: TYPE_LABEL,
    ambitionLabels: AMBITION_LABEL,
    memoryStateLabels: MEMORY_LABEL,
  },
  "ko-KR": {
    eyebrow: "관리자 맥락 대시보드",
    title: "맥락 대시보드",
    intro: "저장된 영감이 맥락 노드와 관계로 이어지는 흐름을 확인합니다.",
    rebuild: "그래프 다시 만들기",
    rebuilding: "그래프 다시 만드는 중...",
    refresh: "새로고침",
    refreshing: "새로고침 중...",
    graphEyebrow: "맥락 그래프",
    graphTitle: "그래프",
    graphIntro: "맥락 주장을 필터링하고 근거를 선택하며 노드 하나씩 이동합니다.",
    graphSnapshotAria: "맥락 그래프 요약",
    graphFiltersAria: "맥락 그래프 필터",
    search: "검색",
    searchPlaceholder: "노드, 근거, 노트, 피드백",
    nodeType: "노드 유형",
    allTypes: "모든 유형",
    ambition: "야망",
    allDimensions: "모든 차원",
    status: "상태",
    allStatuses: "모든 상태",
    active: "활성",
    stale: "오래됨",
    memory: "기억",
    allMemoryStates: "모든 기억 상태",
    confidence: "신뢰도",
    recentCorrections: "최근 수정",
    shown: (count) => `${count}개 표시`,
    dragEnabledSummary: "개별 노드 이동이 켜져 있습니다. 옮긴 노드는 그래프를 새로고침할 때까지 위치가 유지됩니다.",
    dragDisabledSummary: "노드 이동이 꺼져 있습니다.",
    edgeLabels: {
      supports: "뒷받침",
      challenges: "긴장시킴",
      points_to: "가리킴",
      asks_for: "요청함",
      reactivates: "다시 활성화",
    },
    signals: (count) => `영감 ${count}개`,
    contextNodes: (count) => `맥락 노드 ${count}개`,
    relationshipEdges: (count) => `관계 ${count}개`,
    graphEvidence: "그래프 근거",
    relationshipEvidence: "관계 근거",
    contextNodeEvidence: "맥락 노드 근거",
    selectGraphEntry: "그래프에서 맥락 노드나 관계를 선택하세요.",
    graphEntryReview: "그래프 입력 검토",
    rebuildConfirmTitle: "맥락 그래프를 다시 만들기 전에",
    rebuildConfirmBody:
      "다시 만들기는 저장된 영감을 다시 읽고, 누락된 신호 패킷을 생성하며, 이 계정의 현재 맥락 그래프 행을 지운 뒤 맥락 노드와 근거, 관계를 다시 만듭니다. 이제 백그라운드 작업으로 실행되므로 대시보드가 진행 상황을 확인하고 완료되면 새로고침됩니다. 이미 작업이 실행 중이면 새 작업 대신 기존 작업을 반환합니다.",
    startRebuild: "다시 만들기 시작",
    cancel: "취소",
    rebuildQueuedPoll: "다시 만들기가 대기열에 추가되었습니다. 이 페이지가 진행 상황을 확인합니다.",
    loadingGraph: "맥락 그래프 불러오는 중...",
    rebuildFinished: (signals, nodes, edges) =>
      `다시 만들기 완료: 영감 ${signals}개 / 노트 ${nodes}개 / 관계 ${edges}개. 대시보드가 새로고침되었습니다.`,
    noGraphRowsTitle: "아직 그래프 행이 없습니다",
    noGraphRowsBody: "로컬에 영감을 저장한 뒤 다시 만들기를 누르세요.",
    noSelectionIntro:
      "위 그래프는 현재 맥락 구조입니다. 맥락 노드를 선택하면 관련 영감을, 관계를 선택하면 연결을 뒷받침하는 근거를 볼 수 있습니다.",
    recentSignalsEyebrow: "최근 영감",
    recentSignalsIntro: "가장 최근 저장 항목과 그것이 맥락 그래프에 더한 내용입니다.",
    recentGraphEntrySummaryAria: "최근 그래프 입력 요약",
    addedNotes: (count) => `노트 ${count}개 추가`,
    addedRelationships: (count) => `관계 ${count}개 추가`,
    notAdded: (count) => `${count}개 미추가`,
    processing: (count) => `${count}개 처리 중`,
    noRecentSignals: "최근 영감이 없습니다.",
    relationshipSummary: "관계 요약",
    updated: "업데이트됨",
    evidenceSignals: "근거 영감",
    type: "유형",
    ambitionDimension: "야망 차원",
    memoryState: "기억 상태",
    reinforcement: "강화",
    reinforcementTotalRecent: (total, recent) => `전체 ${total}회 / 최근 ${recent}회`,
    decay: "감쇠",
    movementScore: "움직임 점수",
    memoryQuality: "기억과 종합 품질",
    whyAmbitionTitle: "이것이 야망에 중요할 수 있는 이유",
    whyAmbitionBody: (dimension) =>
      `이 노드는 현재 ${dimension} 신호로 해석됩니다. 아래의 저장된 영감, 관련 Top of Mind 노트, 피드백을 바탕으로 이 해석이 유용한지 오해를 부르는지 판단하세요.`,
    relatedTopOfMindNotes: "관련 Top of Mind 노트",
    feedback: "피드백",
    matchedRejected: (matched, rejected) => `일치: ${matched} 제외: ${rejected}`,
    rejectedAlternateRead: "제외한 다른 해석:",
    feedbackSource: (source) => `피드백 출처: ${source}`,
    noDescription: "아직 설명이 없습니다.",
    noQualityWarnings: "이 맥락 노드에는 품질 경고가 없습니다.",
    noSavedSignalEvidence: "이 맥락 노드에는 아직 저장된 영감 근거가 없습니다.",
    noActiveTopOfMind: "현재 이 맥락 노드와 연결된 활성 Top of Mind 노트가 없습니다.",
    noRejectedAlternative: "아직 제외한 다른 해석이 저장되지 않았습니다.",
    noPostItFeedback: "아직 이 포스트잇을 조정한 사용자 피드백이 없습니다.",
    noNodeFeedback: "아직 이 맥락 노드에 저장된 사용자 피드백이 없습니다.",
    noRelationshipEvidence: "이 관계에는 저장된 근거 ID가 있지만 현재 피드에는 일치하는 최근 영감이 없습니다.",
    contextNodesHeading: "맥락 노드",
    relationshipEdgesHeading: "관계",
    noContextNodeProcessed: "이 저장 항목에서는 맥락 노드가 생성되거나 강화되지 않았습니다.",
    notFinishedProcessing: "이 저장 항목은 아직 처리가 완료되지 않았습니다.",
    relationshipStoredEvidence: "이 저장 항목은 관계의 근거로 저장되어 있습니다.",
    noRelationshipFromSave: "이 저장 항목에서는 관계가 생성되지 않았습니다.",
    noRelationshipYet: "아직 관계가 없습니다.",
    contextTypeLabels: {
      theme: "주제",
      value: "가치",
      person: "사람",
      aesthetic: "미감",
      tension: "긴장",
      project: "프로젝트",
      open_question: "열린 질문",
      hypothesis: "가설",
      environment: "환경",
      question: "질문",
      desire: "욕구",
      life_direction: "삶의 방향",
      person_archetype: "사람",
    },
    ambitionLabels: {
      place: "장소",
      people: "사람들",
      work: "일",
      taste: "취향",
      identity: "정체성",
      rejection: "거절",
      next_experiment: "다음 실험",
    },
    memoryStateLabels: {
      emerging: "떠오름",
      active: "활성",
      fading: "희미해짐",
      dormant: "잠잠함",
      reactivated: "다시 활성화됨",
      contradicted: "반박됨",
      needs_testing: "검증 필요",
    },
  },
};

export function meaningGraphContextTypeLabel(type: string, locale: SupportedLocale): string {
  return MEANING_GRAPH_COPY[locale].contextTypeLabels[type] ?? TYPE_LABEL[type] ?? type;
}

export function meaningGraphAmbitionLabel(dimension: AmbitionDimension, locale: SupportedLocale): string {
  return MEANING_GRAPH_COPY[locale].ambitionLabels[dimension];
}

export function meaningGraphMemoryStateLabel(state: MemoryStateFilter, locale: SupportedLocale): string {
  return MEANING_GRAPH_COPY[locale].memoryStateLabels[state];
}

function colorForType(type: string): string {
  switch (type) {
    case "question":
      return "#111111";
    case "life_direction":
      return "#2f5e3d";
    case "desire":
      return "#725a24";
    case "value":
      return "#315f78";
    case "tension":
      return "#8a3f33";
    case "environment":
      return "#6b6f32";
    case "person_archetype":
      return "#5d4a75";
    default:
      return "#555555";
  }
}

function edgeColor(kind: string): string {
  switch (kind) {
    case "supports":
      return "#3f6a4c";
    case "challenges":
      return "#9a4a3d";
    case "points_to":
      return "#365f7a";
    case "asks_for":
      return "#796033";
    case "reactivates":
      return "#7052a1";
    default:
      return "#6f6a62";
  }
}

function typeRank(type: string): number {
  const index = TYPE_ORDER.indexOf(type);
  return index === -1 ? TYPE_ORDER.length : index;
}

function ambitionDimensionForNode(node: ApiMeaningGraphNode): AmbitionDimension {
  return node.ambitionDimension ?? "work";
}

function includesSearchText(node: ApiMeaningGraphNode, search: string): boolean {
  if (!search.trim()) return true;
  const haystack = [
    node.label,
    node.description,
    node.contextType,
    node.ambitionDimension,
    node.status,
    ...node.evidence.map((item) => `${item.preview} ${item.reason}`),
    ...node.relatedTopOfMindNotes.map((note) => `${note.title} ${note.why}`),
    ...node.feedback.map((item) => `${item.value} ${item.correctionText ?? ""}`),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(search.trim().toLowerCase());
}

export function filterMeaningGraphNodes(input: {
  nodes: ApiMeaningGraphNode[];
  search: string;
  contextType: string;
  ambitionDimension: string;
  status: string;
  memoryState: string;
  onlyRecentCorrections: boolean;
  minConfidence: number;
}): ApiMeaningGraphNode[] {
  return input.nodes.filter((node) => {
    if (input.contextType !== "all" && node.contextType !== input.contextType) return false;
    if (input.ambitionDimension !== "all" && ambitionDimensionForNode(node) !== input.ambitionDimension) {
      return false;
    }
    if (input.status !== "all" && node.status !== input.status) return false;
    if (input.memoryState !== "all" && node.memory.state !== input.memoryState) return false;
    if (input.onlyRecentCorrections && !hasRecentCorrection(node)) return false;
    if (node.confidence < input.minConfidence) return false;
    return includesSearchText(node, input.search);
  });
}

function hasRecentCorrection(node: ApiMeaningGraphNode): boolean {
  const correctionCutoff = Date.now() - 30 * 86_400_000;
  const feedback = [
    ...node.feedback,
    ...node.relatedTopOfMindNotes.flatMap((note) => note.feedback),
  ];
  return feedback.some((item) => {
    if (!item.correctionText?.trim()) return false;
    const createdAt = new Date(item.createdAt).getTime();
    return Number.isFinite(createdAt) && createdAt >= correctionCutoff;
  });
}

export function meaningGraphDragModeSummary(
  nodesDraggable: boolean,
  locale: SupportedLocale = "en-US",
): string {
  const copy = MEANING_GRAPH_COPY[locale];
  return nodesDraggable ? copy.dragEnabledSummary : copy.dragDisabledSummary;
}

export function updateManualNodePosition(
  current: Map<string, { x: number; y: number }>,
  nodeId: string,
  position: { x: number; y: number },
): Map<string, { x: number; y: number }> {
  const next = new Map(current);
  next.set(nodeId, position);
  return next;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recent";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function isActiveRebuildJob(job: ApiMeaningGraphRebuildJob | null): boolean {
  return job?.status === "pending" || job?.status === "running";
}

export function rebuildJobResult(job: ApiMeaningGraphRebuildJob | null): ApiMeaningGraphRebuildResult | null {
  if (!job || job.status !== "succeeded") return null;
  const payload = job.payload;
  return {
    inspirations: payload.inspirations ?? payload.processedInspirations ?? payload.totalInspirations ?? 0,
    nodesTouched: payload.nodesTouched ?? 0,
    evidenceTouched: payload.evidenceTouched ?? 0,
    edgesTouched: payload.edgesTouched ?? 0,
  };
}

function formatRebuildJobStatus(job: ApiMeaningGraphRebuildJob | null, locale: SupportedLocale): string | null {
  if (!job) return null;
  if (job.status === "pending") {
    return locale === "ko-KR"
      ? "다시 만들기가 대기열에 있습니다. 작업자가 곧 시작합니다."
      : "Rebuild queued. The worker will start shortly.";
  }
  if (job.status === "running") {
    const phase = job.payload.phase?.replace(/_/g, " ") ?? (locale === "ko-KR" ? "처리" : "processing");
    const current = job.payload.processedInspirations;
    const total = job.payload.totalInspirations;
    const count = typeof current === "number" && typeof total === "number" && total > 0
      ? ` (${Math.min(current, total)} / ${total})`
      : "";
    return locale === "ko-KR"
      ? `다시 만들기 진행 중: ${phase}${count}. 완료되면 이 페이지가 새로고침됩니다.`
      : `Rebuild running: ${phase}${count}. This page will refresh when it finishes.`;
  }
  if (job.status === "succeeded") return locale === "ko-KR" ? "다시 만들기 완료. 대시보드가 새로고침되었습니다." : "Rebuild finished. Dashboard refreshed.";
  if (job.status === "failed") {
    return locale === "ko-KR"
      ? `다시 만들기 실패: ${job.lastError ?? "서버 로그 확인"}`
      : `Rebuild failed: ${job.lastError ?? "check server logs"}`;
  }
  return null;
}

function shortPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 130) return normalized;
  return `${normalized.slice(0, 127)}...`;
}

export function relationshipLabel(
  edge: Pick<ApiMeaningGraphEdge, "kind">,
  locale: SupportedLocale = "en-US",
): string {
  return MEANING_GRAPH_COPY[locale].edgeLabels[edge.kind as EdgeKindKey] ?? edge.kind.replace(/_/g, " ");
}

export function relationshipSummary(edge: {
  kind: string;
  sourceLabel: string;
  targetLabel: string;
}, locale: SupportedLocale = "en-US"): string {
  return `${edge.sourceLabel} ${relationshipLabel(edge, locale)} ${edge.targetLabel}`;
}

function compactReason(reason: string): string {
  const normalized = reason.replace(/\s+/g, " ").trim();
  if (!normalized) return "No reason stored yet.";
  if (normalized.length <= 150) return normalized;
  return `${normalized.slice(0, 147).trimEnd()}...`;
}

function readableGraphWarning(type: string, locale: SupportedLocale): string | null {
  switch (type) {
    case "no_data":
      return locale === "ko-KR"
        ? "이 사용자에게 아직 저장된 영감이 없습니다."
        : "No signals have been saved for this user yet.";
    case "no_packets":
    case "stale":
      return locale === "ko-KR"
        ? "일부 저장 항목이 아직 그래프로 처리되지 않았습니다. 다시 만들기로 해결할 수 있습니다."
        : "Some saves have not been processed into the graph yet. Rebuild should fix this.";
    case "writer_failed":
      return locale === "ko-KR"
        ? "그래프 작성기가 정상적으로 완료되지 않았습니다. 다시 만든 뒤에도 계속되면 서버 로그를 확인하세요."
        : "The graph writer did not finish cleanly. Rebuild, then check the server logs if this remains.";
    default:
      return null;
  }
}

function runLayout(
  rawNodes: ApiMeaningGraphNode[],
  rawEdges: ApiMeaningGraphEdge[],
): Map<string, { x: number; y: number }> {
  const simNodes: SimNode[] = rawNodes.map((node) => ({
    id: node.id,
    weight: Math.max(1, node.weight),
  }));
  const simLinks: SimulationLinkDatum<SimNode>[] = rawEdges.map((edge) => ({
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
  }));

  const weightByPair = new Map<string, number>();
  for (const edge of rawEdges) {
    weightByPair.set(`${edge.sourceNodeId}|${edge.targetNodeId}`, edge.weight);
  }

  const sim = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((node) => node.id)
        .distance((link) => {
          const source = (link.source as SimNode).id;
          const target = (link.target as SimNode).id;
          const weight = weightByPair.get(`${source}|${target}`) ?? 80;
          return Math.max(145, 340 - Math.sqrt(weight) * 10);
        })
        .strength(0.42),
    )
    .force(
      "charge",
      forceManyBody<SimNode>().strength((node) => -520 - Math.sqrt(node.weight) * 26),
    )
    .force("center", forceCenter(540, 330))
    .force("collide", forceCollide<SimNode>(150))
    .stop();

  for (let index = 0; index < 420; index += 1) sim.tick();

  const positions = new Map<string, { x: number; y: number }>();
  for (const node of simNodes) {
    positions.set(node.id, { x: node.x ?? 0, y: node.y ?? 0 });
  }
  return positions;
}

const MeaningFlowNode = memo(({ data }: NodeProps<MeaningNodeData>) => (
  <div
    className="meaning-flow-node"
    data-focus={data.isFocus || undefined}
    data-fade={data.fade || undefined}
    style={{
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      borderColor: data.isFocus ? colorForType(data.type) : undefined,
    }}
  >
    <Handle type="target" position={Position.Top} style={{ visibility: "hidden" }} />
    <Handle type="source" position={Position.Bottom} style={{ visibility: "hidden" }} />
    <span className="meaning-flow-node-type" style={{ color: colorForType(data.type) }}>
      {TYPE_LABEL[data.contextType] ?? TYPE_LABEL[data.type] ?? data.type} / {AMBITION_LABEL[data.ambitionDimension]}
    </span>
    <p className="meaning-flow-node-label">{data.label}</p>
    <span className="meaning-flow-node-meta">
      {Math.round(data.weight)} weight / {data.evidenceCount} evidence
    </span>
  </div>
));
MeaningFlowNode.displayName = "MeaningFlowNode";

const nodeTypes = { meaning: MeaningFlowNode };
const edgeTypes = { floating: FloatingEdge };
const EMPTY_NEIGHBORS = new Set<string>();

export default function MeaningGraphPage(): JSX.Element {
  const { user } = useAuth();
  const locale = normalizeSupportedLocale(user?.preferredLocale ?? readStoredLocale());
  const copy = MEANING_GRAPH_COPY[locale];
  const [graph, setGraph] = useState<ApiMeaningGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [contextTypeFilter, setContextTypeFilter] = useState("all");
  const [ambitionFilter, setAmbitionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [memoryStateFilter, setMemoryStateFilter] = useState("all");
  const [onlyRecentCorrections, setOnlyRecentCorrections] = useState(false);
  const [minConfidence, setMinConfidence] = useState(0);
  const [manualNodePositions, setManualNodePositions] = useState<Map<string, { x: number; y: number }>>(
    () => new Map(),
  );
  const [rebuilding, setRebuilding] = useState(false);
  const [confirmingRebuild, setConfirmingRebuild] = useState(false);
  const [rebuildJob, setRebuildJob] = useState<ApiMeaningGraphRebuildJob | null>(null);
  const lastRebuild = rebuildJobResult(rebuildJob);
  const rebuildStatusMessage = formatRebuildJobStatus(rebuildJob, locale);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMeaningGraph(120);
      setGraph(next);
      setSelectedNodeId((current) => current ?? next.nodes[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadingGraph);
    } finally {
      setLoading(false);
    }
  }, [copy.loadingGraph]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const handleRequestRebuild = useCallback(() => {
    setError(null);
    setConfirmingRebuild(true);
  }, []);

  const handleCancelRebuild = useCallback(() => {
    setConfirmingRebuild(false);
  }, []);

  const handleRebuild = useCallback(async () => {
    setRebuilding(true);
    setConfirmingRebuild(false);
    setError(null);
    try {
      const result = await rebuildMeaningGraph();
      setRebuildJob(result.job);
      setRebuilding(isActiveRebuildJob(result.job));
    } catch (err) {
      setError(formatMeaningGraphRebuildError(err));
      setRebuilding(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadLatestJob(): Promise<void> {
      try {
        const { job } = await fetchMeaningGraphRebuildJob();
        if (cancelled || !job) return;
        setRebuildJob(job);
        setRebuilding(isActiveRebuildJob(job));
        if (job.status === "succeeded") {
          await loadGraph();
        }
      } catch {
        // The graph itself is the primary view; status polling errors are
        // surfaced only after a user explicitly starts a rebuild.
      }
    }

    void loadLatestJob();
    return () => {
      cancelled = true;
    };
  }, [loadGraph]);

  useEffect(() => {
    if (!rebuildJob || !isActiveRebuildJob(rebuildJob)) return;
    const jobId = rebuildJob.id;
    let cancelled = false;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const { job } = await fetchMeaningGraphRebuildJob(jobId);
          if (cancelled || !job) return;
          setRebuildJob(job);
          const stillActive = isActiveRebuildJob(job);
          setRebuilding(stillActive);
          if (!stillActive && job.status === "succeeded") {
            await loadGraph();
          }
        } catch (err) {
          if (!cancelled) {
            setError(formatMeaningGraphRebuildError(err));
          }
        }
      })();
    }, REBUILD_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadGraph, rebuildJob]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];
  const recentInspirations = graph?.recentInspirations ?? [];
  const health = graph?.meta.health ?? null;
  const visibleHealthWarnings = useMemo(
    () =>
      (health?.warnings ?? [])
        .map((warning) => readableGraphWarning(warning.type, locale))
        .filter((message): message is string => Boolean(message)),
    [health, locale],
  );

  const recentReviewStats = useMemo(() => {
    let enteredGraph = 0;
    let withRelationships = 0;
    let processedWithoutNotes = 0;
    let processing = 0;

    for (const signal of recentInspirations) {
      if (!signal.packetCreatedAt) {
        processing += 1;
      } else if (signal.meaningNotes.length === 0) {
        processedWithoutNotes += 1;
      } else {
        enteredGraph += 1;
      }

      if (signal.relationshipEdges.length > 0) {
        withRelationships += 1;
      }
    }

    return {
      enteredGraph,
      withRelationships,
      processedWithoutNotes,
      processing,
    };
  }, [recentInspirations]);

  const sortedNodes = useMemo(
    () =>
      [...nodes].sort(
        (a, b) =>
          b.evidenceCount - a.evidenceCount ||
          b.weight - a.weight ||
          typeRank(a.type) - typeRank(b.type),
      ),
    [nodes],
  );

  const contextTypeOptions = useMemo(
    () => [...new Set(nodes.map((node) => node.contextType))].sort((a, b) => typeRank(a) - typeRank(b)),
    [nodes],
  );

  const filteredNodes = useMemo(
    () =>
      filterMeaningGraphNodes({
        nodes: sortedNodes,
        search: searchText,
        contextType: contextTypeFilter,
        ambitionDimension: ambitionFilter,
        status: statusFilter,
        memoryState: memoryStateFilter,
        onlyRecentCorrections,
        minConfidence,
      }),
    [
      ambitionFilter,
      contextTypeFilter,
      memoryStateFilter,
      minConfidence,
      onlyRecentCorrections,
      searchText,
      sortedNodes,
      statusFilter,
    ],
  );

  const visibleMeaningNodes = useMemo(
    () =>
      filteredNodes
        .filter((node, index) => node.evidenceCount > 1 || node.weight >= 160 || index < 24)
        .slice(0, MAX_VISIBLE_NODES),
    [filteredNodes],
  );

  const visibleNodeIds = useMemo(
    () => new Set(visibleMeaningNodes.map((node) => node.id)),
    [visibleMeaningNodes],
  );

  const visibleMeaningEdges = useMemo(
    () =>
      edges
        .filter(
          (edge) =>
            visibleNodeIds.has(edge.sourceNodeId) &&
            visibleNodeIds.has(edge.targetNodeId),
        )
        .sort((a, b) => b.weight - a.weight)
        .slice(0, MAX_VISIBLE_EDGES),
    [edges, visibleNodeIds],
  );

  const nodeById = useMemo(
    () => new Map(nodes.map((node) => [node.id, node] as const)),
    [nodes],
  );

  const selectedNode = selectedNodeId ? nodeById.get(selectedNodeId) ?? null : null;
  const selectedEdge = selectedEdgeId
    ? edges.find((edge) => edge.id === selectedEdgeId) ?? null
    : null;

  const neighborsByNode = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of visibleMeaningEdges) {
      if (!map.has(edge.sourceNodeId)) map.set(edge.sourceNodeId, new Set());
      if (!map.has(edge.targetNodeId)) map.set(edge.targetNodeId, new Set());
      map.get(edge.sourceNodeId)!.add(edge.targetNodeId);
      map.get(edge.targetNodeId)!.add(edge.sourceNodeId);
    }
    return map;
  }, [visibleMeaningEdges]);

  const baseFlowNodes = useMemo<Node<MeaningNodeData>[]>(() => {
    if (!graph) return [];

    const positions = runLayout(visibleMeaningNodes, visibleMeaningEdges);
    return visibleMeaningNodes.map((node) => {
      const layoutPosition = positions.get(node.id) ?? { x: 540, y: 330 };
      const position = manualNodePositions.get(node.id) ?? {
        x: layoutPosition.x - NODE_WIDTH / 2,
        y: layoutPosition.y - NODE_HEIGHT / 2,
      };
      return {
        id: node.id,
        type: "meaning",
        position,
        data: {
          type: node.type,
          contextType: node.contextType,
          ambitionDimension: ambitionDimensionForNode(node),
          label: node.label,
          description: node.description,
          weight: node.weight,
          evidenceCount: node.evidenceCount,
          isFocus: false,
          fade: false,
        },
        draggable: true,
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      };
    });
  }, [graph, manualNodePositions, visibleMeaningEdges, visibleMeaningNodes]);

  const focusNodeId = hoverNodeId;
  const selectedOrHoverNodeId = hoverNodeId ?? selectedNodeId;
  const focusNeighbors = focusNodeId
    ? neighborsByNode.get(focusNodeId) ?? EMPTY_NEIGHBORS
    : null;

  const flowNodes = useMemo(
    () =>
      baseFlowNodes.map((node) => {
        const isFocus = selectedOrHoverNodeId === node.id;
        const isNeighbor = focusNeighbors?.has(node.id) ?? false;
        const fade = hoverNodeId !== null && !isFocus && !isNeighbor;

        if (node.data.isFocus === isFocus && node.data.fade === fade) {
          return node;
        }

        return {
          ...node,
          data: {
            ...node.data,
            isFocus,
            fade,
          },
        };
      }),
    [baseFlowNodes, focusNeighbors, hoverNodeId, selectedOrHoverNodeId],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      visibleMeaningEdges.map((edge) => {
        const isFocus =
          focusNodeId !== null &&
          (edge.sourceNodeId === focusNodeId || edge.targetNodeId === focusNodeId);
        const isSelected = selectedEdgeId === edge.id;
        const fade = focusNodeId !== null && !isFocus;
        const normalized = Math.min(1, Math.max(0.15, edge.weight / 1000));
        return {
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          type: "floating",
          label: relationshipLabel(edge, locale),
          style: {
            stroke: edgeColor(edge.kind),
            strokeWidth: isSelected ? 3 : 0.8 + normalized * 2.8,
            opacity: hoverNodeId !== null && fade ? 0.08 : isFocus || isSelected ? 0.78 : 0.28,
          },
          labelStyle: {
            fontSize: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            color: edgeColor(edge.kind),
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          },
          labelBgPadding: [7, 4] as [number, number],
          labelBgBorderRadius: 999,
          labelBgStyle: {
            backgroundColor: "rgba(253, 251, 245, 0.98)",
            border: "1px solid rgba(15, 15, 14, 0.12)",
          },
          labelShowBg: true,
        };
      }),
    [focusNodeId, hoverNodeId, locale, selectedEdgeId, visibleMeaningEdges],
  );

  const handleNodeDragStop = useCallback((_: unknown, node: Node<MeaningNodeData>) => {
    setManualNodePositions((current) => updateManualNodePosition(current, node.id, node.position));
  }, []);

  const selectedEdgeSource = selectedEdge
    ? nodeById.get(selectedEdge.sourceNodeId) ?? null
    : null;
  const selectedEdgeTarget = selectedEdge
    ? nodeById.get(selectedEdge.targetNodeId) ?? null
    : null;
  const selectedEdgeEvidence = selectedEdge
    ? recentInspirations.filter((signal) =>
        signal.relationshipEdges.some((edge) => edge.id === selectedEdge.id),
      )
    : [];

  const evidenceHeading = selectedEdge
    ? copy.relationshipEvidence
    : selectedNode
      ? copy.contextNodeEvidence
      : copy.graphEvidence;

  const evidenceIntro = selectedEdge
    ? `${selectedEdgeSource?.label ?? (locale === "ko-KR" ? "알 수 없는 출처" : "Unknown source")} ${relationshipLabel(selectedEdge, locale)} ${
        selectedEdgeTarget?.label ?? (locale === "ko-KR" ? "알 수 없는 대상" : "unknown target")
      }`
    : selectedNode
      ? selectedNode.label
      : copy.selectGraphEntry;

  const renderRecentInspiration = (
    signal: ApiMeaningGraphRecentInspiration,
  ): JSX.Element => {
    const hasMeaningNotes = signal.meaningNotes.length > 0;
    const hasRelationships = signal.relationshipEdges.length > 0;
    const status = !signal.packetCreatedAt
      ? locale === "ko-KR" ? "처리 중" : "Processing"
      : hasMeaningNotes
        ? hasRelationships
          ? locale === "ko-KR" ? "노트와 관계 추가됨" : "Added notes and relationships"
          : locale === "ko-KR" ? "맥락 노드 추가됨" : "Added context nodes"
        : locale === "ko-KR" ? "그래프에 추가되지 않음" : "Not added to graph";

    return (
      <article className="meaning-recent-inspiration" key={signal.id}>
        <div className="meaning-recent-inspiration-head">
          <time dateTime={signal.createdAt}>{formatDate(signal.createdAt)}</time>
          <span data-state={hasMeaningNotes ? "entered" : signal.packetCreatedAt ? "not-added" : "processing"}>
            {status}
          </span>
        </div>
        <blockquote>{shortPreview(signal.preview)}</blockquote>
        <div className="meaning-recent-outcomes">
          <section>
            <h3>{copy.contextNodesHeading}</h3>
            {hasMeaningNotes ? (
              <ul>
                {signal.meaningNotes.map((note) => (
                  <li key={`${signal.id}-${note.id}`}>
                    <strong>{note.label}</strong>
                    <span>{TYPE_LABEL[note.type] ?? note.type}</span>
                    <p>{compactReason(note.reason)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {signal.packetCreatedAt
                  ? copy.noContextNodeProcessed
                  : copy.notFinishedProcessing}
              </p>
            )}
          </section>
          <section>
            <h3>{copy.relationshipEdgesHeading}</h3>
            {hasRelationships ? (
              <ul>
                {signal.relationshipEdges.map((edge) => (
                  <li key={`${signal.id}-${edge.id}`}>
                    <strong>{relationshipSummary(edge, locale)}</strong>
                    <span>{relationshipLabel(edge, locale)}</span>
                    {edge.sourceReason || edge.targetReason ? (
                      <p>
                        {[edge.sourceReason, edge.targetReason]
                          .filter(Boolean)
                          .map(compactReason)
                          .join(" ")}
                      </p>
                    ) : (
                      <p>{copy.relationshipStoredEvidence}</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {hasMeaningNotes
                  ? copy.noRelationshipFromSave
                  : copy.noRelationshipYet}
              </p>
            )}
          </section>
        </div>
      </article>
    );
  };

  return (
    <main className="meaning-graph-page">
      <header className="meaning-graph-header">
        <div>
          <span>{copy.eyebrow}</span>
          <h1>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
        <div className="meaning-graph-actions">
          <button
            type="button"
            disabled={rebuilding || loading}
            onClick={handleRequestRebuild}
          >
            {rebuilding ? copy.rebuilding : copy.rebuild}
          </button>
          <button type="button" onClick={() => void loadGraph()} disabled={loading || rebuilding}>
            {loading ? copy.refreshing : copy.refresh}
          </button>
        </div>
      </header>

      {confirmingRebuild ? (
        <section className="meaning-graph-rebuild-alert" role="alert" aria-live="polite">
          <div>
            <strong>{copy.rebuildConfirmTitle}</strong>
            <p>{copy.rebuildConfirmBody}</p>
          </div>
          <div className="meaning-graph-rebuild-alert-actions">
            <button type="button" onClick={() => void handleRebuild()} disabled={rebuilding}>
              {copy.startRebuild}
            </button>
            <button type="button" onClick={handleCancelRebuild} disabled={rebuilding}>
              {copy.cancel}
            </button>
          </div>
        </section>
      ) : null}

      {rebuilding || rebuildStatusMessage ? (
        <p
          className={`meaning-graph-status${rebuildJob?.status === "failed" ? " meaning-graph-status--error" : " meaning-graph-status--running"}`}
          aria-live="polite"
        >
          {rebuildStatusMessage ?? copy.rebuildQueuedPoll}
        </p>
      ) : null}

      {loading ? (
        <p className="meaning-graph-status">{copy.loadingGraph}</p>
      ) : error ? (
        <p className="meaning-graph-status meaning-graph-status--error">{error}</p>
      ) : (
        <>
          <section className="meaning-dashboard-graph-row">
            <section className="meaning-graph-workbench meaning-graph-workbench--flow">
              <div className="meaning-dashboard-section-heading">
                <div>
                  <span>{copy.graphEyebrow}</span>
                  <h2>{copy.graphTitle}</h2>
                  <p>{copy.graphIntro}</p>
                </div>
                {health ? (
                  <div className="meaning-dashboard-inline-meta" aria-label={copy.graphSnapshotAria}>
                    <span>{copy.signals(health.inspirationCount)}</span>
                    <span>{copy.contextNodes(health.nodeCount)}</span>
                    <span>{copy.relationshipEdges(health.edgeCount)}</span>
                  </div>
                ) : null}
              </div>
              {visibleHealthWarnings.length > 0 || lastRebuild ? (
                <div className="meaning-dashboard-compact-status">
                  {lastRebuild ? (
                    <span>{copy.rebuildFinished(lastRebuild.inspirations, lastRebuild.nodesTouched, lastRebuild.edgesTouched)}</span>
                  ) : null}
                  {visibleHealthWarnings.map((message) => (
                    <span key={message}>{message}</span>
                  ))}
                </div>
              ) : null}
              <div className="meaning-graph-filterbar" aria-label={copy.graphFiltersAria}>
                <label>
                  {copy.search}
                  <input
                    value={searchText}
                    onChange={(event) => setSearchText(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                  />
                </label>
                <label>
                  {copy.nodeType}
                  <select value={contextTypeFilter} onChange={(event) => setContextTypeFilter(event.target.value)}>
                    <option value="all">{copy.allTypes}</option>
                    {contextTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {meaningGraphContextTypeLabel(type, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {copy.ambition}
                  <select value={ambitionFilter} onChange={(event) => setAmbitionFilter(event.target.value)}>
                    <option value="all">{copy.allDimensions}</option>
                    {AMBITION_DIMENSIONS.map((dimension) => (
                      <option key={dimension} value={dimension}>
                        {meaningGraphAmbitionLabel(dimension, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {copy.status}
                  <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                    <option value="all">{copy.allStatuses}</option>
                    <option value="active">{copy.active}</option>
                    <option value="stale">{copy.stale}</option>
                  </select>
                </label>
                <label>
                  {copy.memory}
                  <select value={memoryStateFilter} onChange={(event) => setMemoryStateFilter(event.target.value)}>
                    <option value="all">{copy.allMemoryStates}</option>
                    {MEMORY_STATES.map((state) => (
                      <option key={state} value={state}>
                        {meaningGraphMemoryStateLabel(state, locale)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {copy.confidence}
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={minConfidence}
                    onChange={(event) => setMinConfidence(Number(event.target.value))}
                  />
                  <span>{minConfidence}%+</span>
                </label>
                <label className="meaning-graph-checkbox-filter">
                  <input
                    type="checkbox"
                    checked={onlyRecentCorrections}
                    onChange={(event) => setOnlyRecentCorrections(event.target.checked)}
                  />
                  {copy.recentCorrections}
                </label>
                <span>{copy.shown(visibleMeaningNodes.length)}</span>
                <span>{meaningGraphDragModeSummary(true, locale)}</span>
              </div>
              <div className="meaning-graph-flow-shell">
                {nodes.length === 0 ? (
                  <div className="meaning-graph-empty">
                    <strong>{copy.noGraphRowsTitle}</strong>
                    <span>{copy.noGraphRowsBody}</span>
                  </div>
                ) : (
                  <ReactFlow
                    nodes={flowNodes}
                    edges={flowEdges}
                    nodeTypes={nodeTypes}
                    edgeTypes={edgeTypes}
                    fitView
                    fitViewOptions={{ padding: 0.25 }}
                    minZoom={0.22}
                    maxZoom={1.8}
                    nodesDraggable
                    nodesConnectable={false}
                    elementsSelectable
                    proOptions={{ hideAttribution: true }}
                    onNodeClick={(_, node) => {
                      setSelectedEdgeId(null);
                      setSelectedNodeId(node.id);
                    }}
                    onEdgeClick={(_, edge) => {
                      setSelectedNodeId(null);
                      setSelectedEdgeId((current) => (current === edge.id ? null : edge.id));
                    }}
                    onNodeDragStop={handleNodeDragStop}
                    onNodeMouseEnter={(_, node) => setHoverNodeId(node.id)}
                    onNodeMouseLeave={() => setHoverNodeId(null)}
                    onPaneClick={() => {
                      setSelectedNodeId(null);
                      setSelectedEdgeId(null);
                    }}
                  />
                )}
              </div>
            </section>

            <section className="meaning-dashboard-panel meaning-graph-detail" aria-labelledby="graph-evidence-title">
              <span>{evidenceHeading}</span>
              <h2 id="graph-evidence-title">{evidenceIntro}</h2>
            {selectedEdge ? (
              <>
                <dl>
                  <div>
                    <dt>{copy.evidenceSignals}</dt>
                    <dd>{selectedEdge.evidenceCount}</dd>
                  </div>
                  <div>
                    <dt>{copy.updated}</dt>
                    <dd>{formatDate(selectedEdge.lastReinforcedAt)}</dd>
                  </div>
                </dl>
                <div className="meaning-graph-evidence-list">
                  <h3>{copy.evidenceSignals}</h3>
                  {selectedEdgeEvidence.length > 0 ? (
                    selectedEdgeEvidence.map((signal) => (
                      <article key={`${selectedEdge.id}-${signal.id}`}>
                        <time dateTime={signal.createdAt}>{formatDate(signal.createdAt)}</time>
                        <blockquote>{shortPreview(signal.preview)}</blockquote>
                      </article>
                    ))
                  ) : (
                    <p>{copy.noRelationshipEvidence}</p>
                  )}
                </div>
              </>
            ) : selectedNode ? (
              <>
                <p>{selectedNode.description || copy.noDescription}</p>
                <dl>
                  <div>
                    <dt>{copy.type}</dt>
                    <dd>{TYPE_LABEL[selectedNode.contextType] ?? selectedNode.contextType}</dd>
                  </div>
                  <div>
                    <dt>{copy.ambitionDimension}</dt>
                    <dd>{AMBITION_LABEL[ambitionDimensionForNode(selectedNode)]}</dd>
                  </div>
                  <div>
                    <dt>{copy.evidenceSignals}</dt>
                    <dd>{selectedNode.evidenceCount}</dd>
                  </div>
                  <div>
                    <dt>{copy.updated}</dt>
                    <dd>{formatDate(selectedNode.lastReinforcedAt)}</dd>
                  </div>
                  <div>
                    <dt>{copy.memoryState}</dt>
                    <dd>{MEMORY_LABEL[selectedNode.memory.state]}</dd>
                  </div>
                  <div>
                    <dt>{copy.reinforcement}</dt>
                    <dd>
                      {copy.reinforcementTotalRecent(
                        selectedNode.memory.reinforcementCount,
                        selectedNode.memory.recentReinforcementCount,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{copy.decay}</dt>
                    <dd>{selectedNode.memory.decay}</dd>
                  </div>
                  <div>
                    <dt>{copy.movementScore}</dt>
                    <dd>{selectedNode.memory.movementScore}</dd>
                  </div>
                </dl>
                <div className="meaning-graph-evidence-list">
                  <h3>{copy.memoryQuality}</h3>
                  {selectedNode.qualityIndicators.length > 0 ? (
                    selectedNode.qualityIndicators.map((indicator) => (
                      <article key={`${selectedNode.id}-${indicator.type}`}>
                        <time>{indicator.severity}</time>
                        <blockquote>{indicator.label}</blockquote>
                        <p>{indicator.detail}</p>
                      </article>
                    ))
                  ) : (
                    <p>{copy.noQualityWarnings}</p>
                  )}
                </div>
                <div className="meaning-graph-evidence-list">
                  <h3>{copy.whyAmbitionTitle}</h3>
                  <p>{copy.whyAmbitionBody(meaningGraphAmbitionLabel(ambitionDimensionForNode(selectedNode), locale))}</p>
                </div>
                <div className="meaning-graph-evidence-list">
                  <h3>{copy.evidenceSignals}</h3>
                  {selectedNode.evidence.length > 0 ? (
                    selectedNode.evidence.slice(0, 6).map((evidence) => (
                      <article key={`${selectedNode.id}-${evidence.inspirationId}-${evidence.packetId}`}>
                        <time>{formatDate(evidence.createdAt)}</time>
                        <blockquote>
                          {shortPreview(evidence.preview || evidence.packetPreview)}
                        </blockquote>
                        <p>{evidence.reason}</p>
                      </article>
                    ))
                  ) : (
                    <p>{copy.noSavedSignalEvidence}</p>
                  )}
                </div>
                <div className="meaning-graph-evidence-list">
                  <h3>{copy.relatedTopOfMindNotes}</h3>
                  {selectedNode.relatedTopOfMindNotes.length > 0 ? (
                    selectedNode.relatedTopOfMindNotes.map((note) => (
                      <article key={`${selectedNode.id}-${note.id}`}>
                        <time dateTime={note.createdAt}>{formatDate(note.createdAt)}</time>
                        <blockquote>{note.title}</blockquote>
                        <p>{note.whyNow}</p>
                        <p>{note.changedRecently}</p>
                        <p>{note.evidenceRationale}</p>
                        <p>
                          {copy.matchedRejected(note.matchedEnvironment, note.antiEnvironment)}
                        </p>
                        <p>
                          {copy.rejectedAlternateRead}{" "}
                          {note.rejectedAlternativeInterpretation ?? copy.noRejectedAlternative}
                        </p>
                        {note.qualityIndicators.length > 0 ? (
                          <ul className="meaning-quality-list">
                            {note.qualityIndicators.map((indicator) => (
                              <li key={`${note.id}-${indicator.type}`}>
                                <strong>{indicator.label}</strong>
                                <span>{indicator.detail}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {note.feedback.length > 0 ? (
                          <ul className="meaning-quality-list">
                            {note.feedback.map((item) => (
                              <li key={`${note.id}-${item.id}`}>
                                <strong>{item.value.replaceAll("_", " ")}</strong>
                                <span>{item.correctionText || copy.feedbackSource(item.source)}</span>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p>{copy.noPostItFeedback}</p>
                        )}
                      </article>
                    ))
                  ) : (
                    <p>{copy.noActiveTopOfMind}</p>
                  )}
                </div>
                <div className="meaning-graph-evidence-list">
                  <h3>{copy.feedback}</h3>
                  {selectedNode.feedback.length > 0 ? (
                    selectedNode.feedback.map((item) => (
                      <article key={`${selectedNode.id}-${item.id}`}>
                        <time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time>
                        <blockquote>
                          {item.value.replaceAll("_", " ")}
                          {item.emotionLabel ? ` / ${item.emotionLabel.replaceAll("_", " ")}` : ""}
                        </blockquote>
                        <p>{item.correctionText || copy.feedbackSource(item.source)}</p>
                      </article>
                    ))
                  ) : (
                    <p>{copy.noNodeFeedback}</p>
                  )}
                </div>
              </>
            ) : (
              <p>{copy.noSelectionIntro}</p>
            )}
            </section>
          </section>

          <section className="meaning-dashboard-grid meaning-dashboard-grid--recent">
            <section className="meaning-dashboard-panel meaning-recent-feed" aria-labelledby="recent-inspirations-title">
              <div className="meaning-dashboard-section-heading">
                <div>
                  <span>{copy.recentSignalsEyebrow}</span>
                  <h2 id="recent-inspirations-title">{copy.graphEntryReview}</h2>
                  <p>{copy.recentSignalsIntro}</p>
                </div>
                <div className="meaning-dashboard-inline-meta" aria-label={copy.recentGraphEntrySummaryAria}>
                  <span>{copy.addedNotes(recentReviewStats.enteredGraph)}</span>
                  <span>{copy.addedRelationships(recentReviewStats.withRelationships)}</span>
                  <span>{copy.notAdded(recentReviewStats.processedWithoutNotes)}</span>
                  {recentReviewStats.processing > 0 ? (
                    <span>{copy.processing(recentReviewStats.processing)}</span>
                  ) : null}
                </div>
              </div>
              <div className="meaning-recent-inspiration-list">
                {recentInspirations.length > 0 ? (
                  recentInspirations.map(renderRecentInspiration)
                ) : (
                  <p>{copy.noRecentSignals}</p>
                )}
              </div>
            </section>
          </section>
        </>
      )}
    </main>
  );
}
