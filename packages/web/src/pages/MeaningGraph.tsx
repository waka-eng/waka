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
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  useNodesState,
  type Edge,
  type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";

import { FloatingEdge } from "../components/FloatingEdge";
import {
  fetchMeaningGraph,
  type ApiMeaningGraph,
  type ApiMeaningGraphEdge,
  type ApiMeaningGraphNode,
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

function shortPreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 130) return normalized;
  return `${normalized.slice(0, 127)}...`;
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
    <span className="meaning-flow-node-meta">
      {data.evidenceCount} evidence · {data.weight} weight
    </span>
  </div>
));
MeaningFlowNode.displayName = "MeaningFlowNode";

const nodeTypes = { meaning: MeaningFlowNode };
const edgeTypes = { floating: FloatingEdge };

export default function MeaningGraphPage(): JSX.Element {
  const [graph, setGraph] = useState<ApiMeaningGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [flowNodes, setFlowNodes, onNodesChange] =
    useNodesState<MeaningNodeData>([]);

  const loadGraph = useCallback(async (rebuild = false) => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMeaningGraph(120, rebuild);
      setGraph(next);
      setSelectedNodeId((current) => current ?? next.nodes[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load meaning graph");
    } finally {
      setLoading(false);
      setRebuilding(false);
    }
  }, []);

  useEffect(() => {
    void loadGraph(false);
  }, [loadGraph]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];

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

  useEffect(() => {
    if (!graph) {
      setFlowNodes([]);
      return;
    }

    const positions = runLayout(visibleMeaningNodes, visibleMeaningEdges);
    setFlowNodes(
      visibleMeaningNodes.map((node) => {
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
      }),
    );
  }, [graph, setFlowNodes, visibleMeaningEdges, visibleMeaningNodes]);

  const focusNodeId = hoverNodeId ?? selectedNodeId;
  const focusNeighbors = focusNodeId
    ? neighborsByNode.get(focusNodeId) ?? new Set<string>()
    : null;

  useEffect(() => {
    setFlowNodes((previous) =>
      previous.map((node) => {
        const isFocus = focusNodeId === node.id;
        const isNeighbor = focusNeighbors?.has(node.id) ?? false;
        return {
          ...node,
          data: {
            ...node.data,
            isFocus,
            fade: focusNodeId !== null && !isFocus && !isNeighbor,
          },
        };
      }),
    );
  }, [focusNeighbors, focusNodeId, setFlowNodes]);

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
          label: isFocus || isSelected ? EDGE_LABEL[edge.kind] ?? edge.kind : undefined,
          style: {
            stroke: edgeColor(edge.kind),
            strokeWidth: isSelected ? 3 : 0.8 + normalized * 2.8,
            opacity: fade ? 0.08 : isFocus || isSelected ? 0.78 : 0.28,
          },
          labelStyle: {
            fontSize: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fill: edgeColor(edge.kind),
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          },
          labelBgPadding: [5, 2] as [number, number],
          labelBgBorderRadius: 999,
          labelBgStyle: {
            fill: "rgba(253, 251, 245, 0.94)",
            stroke: "rgba(15, 15, 14, 0.08)",
          },
          labelShowBg: true,
        };
      }),
    [focusNodeId, selectedEdgeId, visibleMeaningEdges],
  );

  const selectedEdgeSource = selectedEdge
    ? nodeById.get(selectedEdge.sourceNodeId) ?? null
    : null;
  const selectedEdgeTarget = selectedEdge
    ? nodeById.get(selectedEdge.targetNodeId) ?? null
    : null;

  return (
    <main className="meaning-graph-page">
      <header className="meaning-graph-header">
        <div>
          <span>meaning graph</span>
          <h1>Meaning graph inspection</h1>
          <p>
            Drag the cards, click a node to inspect its evidence, or click an edge
            to inspect the relationship.
          </p>
        </div>
        <div className="meaning-graph-actions">
          <button
            type="button"
            disabled={rebuilding || loading}
            onClick={() => {
              setRebuilding(true);
              void loadGraph(true);
            }}
          >
            {rebuilding ? "Rebuilding..." : "Rebuild graph"}
          </button>
          <button type="button" onClick={() => void loadGraph(false)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {loading ? (
        <p className="meaning-graph-status">Loading meaning graph...</p>
      ) : error ? (
        <p className="meaning-graph-status meaning-graph-status--error">{error}</p>
      ) : (
        <section className="meaning-graph-workbench meaning-graph-workbench--flow">
          <div className="meaning-graph-summary">
            <span>{graph?.meta.nodeCount ?? 0} meaning nodes</span>
            <span>{graph?.meta.edgeCount ?? 0} meaning edges</span>
            <span>showing {visibleMeaningNodes.length} draggable nodes</span>
            <span>{visibleMeaningEdges.length} clickable edges</span>
            <span>{graph?.meta.evidenceCount ?? 0} evidence rows</span>
          </div>

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
                onNodesChange={onNodesChange}
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
              >
                <Background gap={26} color="#E5E1D8" />
                <Controls showInteractive={false} />
                <MiniMap pannable zoomable maskColor="rgba(253, 251, 245, 0.72)" />
              </ReactFlow>
            )}
          </div>

          <aside className="meaning-graph-detail">
            {selectedEdge ? (
              <>
                <span>{EDGE_LABEL[selectedEdge.kind] ?? selectedEdge.kind}</span>
                <h2>Relationship</h2>
                <p>
                  {selectedEdgeSource?.label ?? "Unknown"}{" "}
                  {EDGE_LABEL[selectedEdge.kind] ?? selectedEdge.kind}{" "}
                  {selectedEdgeTarget?.label ?? "unknown"}.
                </p>
                <dl>
                  <div>
                    <dt>weight</dt>
                    <dd>{selectedEdge.weight}</dd>
                  </div>
                  <div>
                    <dt>confidence</dt>
                    <dd>{selectedEdge.confidence}</dd>
                  </div>
                  <div>
                    <dt>evidence</dt>
                    <dd>{selectedEdge.evidenceCount}</dd>
                  </div>
                  <div>
                    <dt>updated</dt>
                    <dd>{formatDate(selectedEdge.lastReinforcedAt)}</dd>
                  </div>
                </dl>
                <div className="meaning-graph-evidence-list">
                  <h3>Endpoints</h3>
                  <article>
                    <time>{selectedEdgeSource ? TYPE_LABEL[selectedEdgeSource.type] : "source"}</time>
                    <blockquote>{selectedEdgeSource?.label ?? "Unknown source"}</blockquote>
                  </article>
                  <article>
                    <time>{selectedEdgeTarget ? TYPE_LABEL[selectedEdgeTarget.type] : "target"}</time>
                    <blockquote>{selectedEdgeTarget?.label ?? "Unknown target"}</blockquote>
                  </article>
                </div>
              </>
            ) : selectedNode ? (
              <>
                <span>{TYPE_LABEL[selectedNode.type] ?? selectedNode.type}</span>
                <h2>{selectedNode.label}</h2>
                <p>{selectedNode.description || "No description yet."}</p>
                <dl>
                  <div>
                    <dt>weight</dt>
                    <dd>{selectedNode.weight}</dd>
                  </div>
                  <div>
                    <dt>confidence</dt>
                    <dd>{selectedNode.confidence}</dd>
                  </div>
                  <div>
                    <dt>evidence</dt>
                    <dd>{selectedNode.evidenceCount}</dd>
                  </div>
                  <div>
                    <dt>updated</dt>
                    <dd>{formatDate(selectedNode.lastReinforcedAt)}</dd>
                  </div>
                </dl>
                <div className="meaning-graph-evidence-list">
                  <h3>Evidence behind this</h3>
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
              <p>Select a node or edge.</p>
            )}
          </aside>
        </section>
      )}
    </main>
  );
}
