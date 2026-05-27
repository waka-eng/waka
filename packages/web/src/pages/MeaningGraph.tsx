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
  "question",
  "life_direction",
  "desire",
  "value",
  "tension",
  "environment",
  "person_archetype",
];

const TYPE_LABEL: Record<string, string> = {
  value: "value",
  question: "question",
  desire: "desire",
  tension: "tension",
  life_direction: "life direction",
  person_archetype: "person",
  environment: "environment",
};

const EDGE_LABEL: Record<string, string> = {
  supports: "supports",
  challenges: "challenges",
  points_to: "points to",
  asks_for: "asks for",
  reactivates: "reactivates",
};

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

function formatRebuildJobStatus(job: ApiMeaningGraphRebuildJob | null): string | null {
  if (!job) return null;
  if (job.status === "pending") return "Rebuild queued. The worker will start shortly.";
  if (job.status === "running") {
    const phase = job.payload.phase?.replace(/_/g, " ") ?? "processing";
    const current = job.payload.processedInspirations;
    const total = job.payload.totalInspirations;
    const count = typeof current === "number" && typeof total === "number" && total > 0
      ? ` (${Math.min(current, total)} / ${total})`
      : "";
    return `Rebuild running: ${phase}${count}. This page will refresh when it finishes.`;
  }
  if (job.status === "succeeded") return "Rebuild finished. Dashboard refreshed.";
  if (job.status === "failed") return `Rebuild failed: ${job.lastError ?? "check server logs"}`;
  return null;
}

function shortPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 130) return normalized;
  return `${normalized.slice(0, 127)}...`;
}

function relationshipLabel(edge: Pick<ApiMeaningGraphEdge, "kind">): string {
  return EDGE_LABEL[edge.kind] ?? edge.kind.replace(/_/g, " ");
}

function relationshipSummary(edge: {
  kind: string;
  sourceLabel: string;
  targetLabel: string;
}): string {
  return `${edge.sourceLabel} ${EDGE_LABEL[edge.kind] ?? edge.kind.replace(/_/g, " ")} ${edge.targetLabel}`;
}

function compactReason(reason: string): string {
  const normalized = reason.replace(/\s+/g, " ").trim();
  if (!normalized) return "No reason stored yet.";
  if (normalized.length <= 150) return normalized;
  return `${normalized.slice(0, 147).trimEnd()}...`;
}

function readableGraphWarning(type: string): string | null {
  switch (type) {
    case "no_data":
      return "No inspirations have been saved for this user yet.";
    case "no_packets":
    case "stale":
      return "Some saves have not been processed into the graph yet. Rebuild should fix this.";
    case "writer_failed":
      return "The graph writer did not finish cleanly. Rebuild, then check the server logs if this remains.";
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
      {TYPE_LABEL[data.type] ?? data.type}
    </span>
    <p className="meaning-flow-node-label">{data.label}</p>
  </div>
));
MeaningFlowNode.displayName = "MeaningFlowNode";

const nodeTypes = { meaning: MeaningFlowNode };
const edgeTypes = { floating: FloatingEdge };
const EMPTY_NEIGHBORS = new Set<string>();

export default function MeaningGraphPage(): JSX.Element {
  const [graph, setGraph] = useState<ApiMeaningGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [confirmingRebuild, setConfirmingRebuild] = useState(false);
  const [rebuildJob, setRebuildJob] = useState<ApiMeaningGraphRebuildJob | null>(null);
  const lastRebuild = rebuildJobResult(rebuildJob);
  const rebuildStatusMessage = formatRebuildJobStatus(rebuildJob);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMeaningGraph(120);
      setGraph(next);
      setSelectedNodeId((current) => current ?? next.nodes[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load meaning graph");
    } finally {
      setLoading(false);
    }
  }, []);

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
        .map((warning) => readableGraphWarning(warning.type))
        .filter((message): message is string => Boolean(message)),
    [health],
  );

  const recentReviewStats = useMemo(() => {
    let enteredGraph = 0;
    let withRelationships = 0;
    let processedWithoutNotes = 0;
    let processing = 0;

    for (const inspiration of recentInspirations) {
      if (!inspiration.packetCreatedAt) {
        processing += 1;
      } else if (inspiration.meaningNotes.length === 0) {
        processedWithoutNotes += 1;
      } else {
        enteredGraph += 1;
      }

      if (inspiration.relationshipEdges.length > 0) {
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

  const visibleMeaningNodes = useMemo(
    () =>
      sortedNodes
        .filter((node, index) => node.evidenceCount > 1 || node.weight >= 160 || index < 24)
        .slice(0, MAX_VISIBLE_NODES),
    [sortedNodes],
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
      const position = positions.get(node.id) ?? { x: 540, y: 330 };
      return {
        id: node.id,
        type: "meaning",
        position: {
          x: position.x - NODE_WIDTH / 2,
          y: position.y - NODE_HEIGHT / 2,
        },
        data: {
          type: node.type,
          label: node.label,
          description: node.description,
          weight: node.weight,
          evidenceCount: node.evidenceCount,
          isFocus: false,
          fade: false,
        },
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      };
    });
  }, [graph, visibleMeaningEdges, visibleMeaningNodes]);

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
          label: EDGE_LABEL[edge.kind] ?? edge.kind,
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
    [focusNodeId, hoverNodeId, selectedEdgeId, visibleMeaningEdges],
  );

  const selectedEdgeSource = selectedEdge
    ? nodeById.get(selectedEdge.sourceNodeId) ?? null
    : null;
  const selectedEdgeTarget = selectedEdge
    ? nodeById.get(selectedEdge.targetNodeId) ?? null
    : null;
  const selectedEdgeEvidence = selectedEdge
    ? recentInspirations.filter((inspiration) =>
        inspiration.relationshipEdges.some((edge) => edge.id === selectedEdge.id),
      )
    : [];

  const evidenceHeading = selectedEdge
    ? "Relationship evidence"
    : selectedNode
      ? "Meaning note evidence"
      : "Graph evidence";

  const evidenceIntro = selectedEdge
    ? `${selectedEdgeSource?.label ?? "Unknown source"} ${relationshipLabel(selectedEdge)} ${
        selectedEdgeTarget?.label ?? "unknown target"
      }`
    : selectedNode
      ? selectedNode.label
      : "Select a meaning note or relationship edge in the graph.";

  const renderRecentInspiration = (
    inspiration: ApiMeaningGraphRecentInspiration,
  ): JSX.Element => {
    const hasMeaningNotes = inspiration.meaningNotes.length > 0;
    const hasRelationships = inspiration.relationshipEdges.length > 0;
    const status = !inspiration.packetCreatedAt
      ? "Processing"
      : hasMeaningNotes
        ? hasRelationships
          ? "Added notes and relationships"
          : "Added meaning notes"
        : "Not added to graph";

    return (
      <article className="meaning-recent-inspiration" key={inspiration.id}>
        <div className="meaning-recent-inspiration-head">
          <time dateTime={inspiration.createdAt}>{formatDate(inspiration.createdAt)}</time>
          <span data-state={hasMeaningNotes ? "entered" : inspiration.packetCreatedAt ? "not-added" : "processing"}>
            {status}
          </span>
        </div>
        <blockquote>{shortPreview(inspiration.preview)}</blockquote>
        <div className="meaning-recent-outcomes">
          <section>
            <h3>Meaning notes</h3>
            {hasMeaningNotes ? (
              <ul>
                {inspiration.meaningNotes.map((note) => (
                  <li key={`${inspiration.id}-${note.id}`}>
                    <strong>{note.label}</strong>
                    <span>{TYPE_LABEL[note.type] ?? note.type}</span>
                    <p>{compactReason(note.reason)}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {inspiration.packetCreatedAt
                  ? "No meaning note was created or reinforced from this save."
                  : "This save has not finished processing yet."}
              </p>
            )}
          </section>
          <section>
            <h3>Relationship edges</h3>
            {hasRelationships ? (
              <ul>
                {inspiration.relationshipEdges.map((edge) => (
                  <li key={`${inspiration.id}-${edge.id}`}>
                    <strong>{relationshipSummary(edge)}</strong>
                    <span>{relationshipLabel(edge)}</span>
                    {edge.sourceReason || edge.targetReason ? (
                      <p>
                        {[edge.sourceReason, edge.targetReason]
                          .filter(Boolean)
                          .map(compactReason)
                          .join(" ")}
                      </p>
                    ) : (
                      <p>This save is stored as evidence for the relationship.</p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {hasMeaningNotes
                  ? "No relationship edge was created from this save."
                  : "No relationship edge yet."}
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
          <span>admin meaning dashboard</span>
          <h1>Meaning dashboard</h1>
          <p>
            Monitor how saved inspirations become meaning notes and relationship edges.
          </p>
        </div>
        <div className="meaning-graph-actions">
          <button
            type="button"
            disabled={rebuilding || loading}
            onClick={handleRequestRebuild}
          >
            {rebuilding ? "Rebuilding graph..." : "Rebuild graph"}
          </button>
          <button type="button" onClick={() => void loadGraph()} disabled={loading || rebuilding}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {confirmingRebuild ? (
        <section className="meaning-graph-rebuild-alert" role="alert" aria-live="polite">
          <div>
            <strong>Before you rebuild the meaning graph</strong>
            <p>
              Rebuild rereads your saved inspirations, regenerates missing meaning packets, clears the current
              meaning graph rows for this account, then rebuilds meaning notes, evidence, and relationship edges.
              It now runs as a background job, so the dashboard will poll progress and refresh itself when the job
              finishes. Starting another rebuild while one is active will return the existing job.
            </p>
          </div>
          <div className="meaning-graph-rebuild-alert-actions">
            <button type="button" onClick={() => void handleRebuild()} disabled={rebuilding}>
              Start rebuild
            </button>
            <button type="button" onClick={handleCancelRebuild} disabled={rebuilding}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {rebuilding || rebuildStatusMessage ? (
        <p
          className={`meaning-graph-status${rebuildJob?.status === "failed" ? " meaning-graph-status--error" : " meaning-graph-status--running"}`}
          aria-live="polite"
        >
          {rebuildStatusMessage ?? "Rebuild queued. This page will poll for progress."}
        </p>
      ) : null}

      {loading ? (
        <p className="meaning-graph-status">Loading meaning graph...</p>
      ) : error ? (
        <p className="meaning-graph-status meaning-graph-status--error">{error}</p>
      ) : (
        <>
          <section className="meaning-dashboard-graph-row">
            <section className="meaning-graph-workbench meaning-graph-workbench--flow">
              <div className="meaning-dashboard-section-heading">
                <div>
                  <span>meaning graph</span>
                  <h2>Graph</h2>
                  <p>Click a meaning note or relationship edge to update the evidence section.</p>
                </div>
                {health ? (
                  <div className="meaning-dashboard-inline-meta" aria-label="Meaning graph snapshot">
                    <span>{health.inspirationCount} inspirations</span>
                    <span>{health.nodeCount} meaning notes</span>
                    <span>{health.edgeCount} relationship edges</span>
                  </div>
                ) : null}
              </div>
              {visibleHealthWarnings.length > 0 || lastRebuild ? (
                <div className="meaning-dashboard-compact-status">
                  {lastRebuild ? (
                    <span>
                      Rebuild finished: {lastRebuild.inspirations} inspirations / {lastRebuild.nodesTouched} notes /{" "}
                      {lastRebuild.edgesTouched} edges. Dashboard refreshed.
                    </span>
                  ) : null}
                  {visibleHealthWarnings.map((message) => (
                    <span key={message}>{message}</span>
                  ))}
                </div>
              ) : null}
              <div className="meaning-graph-flow-shell">
                {nodes.length === 0 ? (
                  <div className="meaning-graph-empty">
                    <strong>No graph rows yet</strong>
                    <span>Click rebuild after saving inspirations locally.</span>
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
                      setSelectedNodeId((current) => (current === node.id ? null : node.id));
                    }}
                    onEdgeClick={(_, edge) => {
                      setSelectedNodeId(null);
                      setSelectedEdgeId((current) => (current === edge.id ? null : edge.id));
                    }}
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
                    <dt>evidence inspirations</dt>
                    <dd>{selectedEdge.evidenceCount}</dd>
                  </div>
                  <div>
                    <dt>updated</dt>
                    <dd>{formatDate(selectedEdge.lastReinforcedAt)}</dd>
                  </div>
                </dl>
                <div className="meaning-graph-evidence-list">
                  <h3>Evidence inspirations</h3>
                  {selectedEdgeEvidence.length > 0 ? (
                    selectedEdgeEvidence.map((inspiration) => (
                      <article key={`${selectedEdge.id}-${inspiration.id}`}>
                        <time dateTime={inspiration.createdAt}>{formatDate(inspiration.createdAt)}</time>
                        <blockquote>{shortPreview(inspiration.preview)}</blockquote>
                      </article>
                    ))
                  ) : (
                    <p>This relationship has stored evidence ids, but no recent matching inspiration is in the current feed.</p>
                  )}
                </div>
              </>
            ) : selectedNode ? (
              <>
                <p>{selectedNode.description || "No description yet."}</p>
                <dl>
                  <div>
                    <dt>evidence inspirations</dt>
                    <dd>{selectedNode.evidenceCount}</dd>
                  </div>
                  <div>
                    <dt>updated</dt>
                    <dd>{formatDate(selectedNode.lastReinforcedAt)}</dd>
                  </div>
                </dl>
                <div className="meaning-graph-evidence-list">
                  <h3>Evidence inspirations</h3>
                  {selectedNode.evidence.slice(0, 6).map((evidence) => (
                    <article key={`${selectedNode.id}-${evidence.inspirationId}-${evidence.packetId}`}>
                      <time>{formatDate(evidence.createdAt)}</time>
                      <blockquote>
                        {shortPreview(evidence.preview || evidence.packetPreview)}
                      </blockquote>
                      <p>{evidence.reason}</p>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p>The graph above is the current meaning structure. Select a meaning note to see the inspirations behind it, or select a relationship edge to see what supports that connection.</p>
            )}
            </section>
          </section>

          <section className="meaning-dashboard-grid meaning-dashboard-grid--recent">
            <section className="meaning-dashboard-panel meaning-recent-feed" aria-labelledby="recent-inspirations-title">
              <div className="meaning-dashboard-section-heading">
                <div>
                  <span>recent inspirations</span>
                  <h2 id="recent-inspirations-title">Graph entry review</h2>
                  <p>Newest saves and what they added to the meaning graph.</p>
                </div>
                <div className="meaning-dashboard-inline-meta" aria-label="Recent graph entry summary">
                  <span>{recentReviewStats.enteredGraph} added notes</span>
                  <span>{recentReviewStats.withRelationships} added relationships</span>
                  <span>{recentReviewStats.processedWithoutNotes} not added</span>
                  {recentReviewStats.processing > 0 ? (
                    <span>{recentReviewStats.processing} processing</span>
                  ) : null}
                </div>
              </div>
              <div className="meaning-recent-inspiration-list">
                {recentInspirations.length > 0 ? (
                  recentInspirations.map(renderRecentInspiration)
                ) : (
                  <p>No recent inspirations found.</p>
                )}
              </div>
            </section>
          </section>
        </>
      )}
    </main>
  );
}
