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

interface GraphPoint {
  x: number;
  y: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  weight: number;
}

interface MeaningNodeData {
  type: string;
  label: string;
  weight: number;
  evidenceCount: number;
  degree: number;
  isFocus: boolean;
  fade: boolean;
}

const NODE_WIDTH = 238;
const NODE_HEIGHT = 104;

const edgeTypes = { floating: FloatingEdge };

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function edgeColor(kind: string): string {
  switch (kind) {
    case "resonates_with":
    case "supports":
      return "#3f6a4c";
    case "presses_against":
    case "challenges":
      return "#9a4a3d";
    case "returns_to":
    case "reactivates":
      return "#725a24";
    case "clarifies":
    case "points_to":
      return "#315f78";
    case "extends":
    case "asks_for":
      return "#5d4a75";
    case "reframes":
      return "#111111";
    default:
      return "#6f6a62";
  }
}

function edgeLabel(kind: string): string {
  return kind.replace(/_/g, " ");
}

function runLayout(
  rawNodes: ApiMeaningGraphNode[],
  rawEdges: ApiMeaningGraphEdge[],
): Map<string, GraphPoint> {
  const simNodes: SimNode[] = rawNodes.map((node) => ({
    id: node.id,
    weight: Math.max(1, node.weight),
  }));
  const simLinks: SimulationLinkDatum<SimNode>[] = rawEdges.map((edge) => ({
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
  }));
  const confidenceByPair = new Map<string, number>();
  for (const edge of rawEdges) {
    confidenceByPair.set(`${edge.sourceNodeId}|${edge.targetNodeId}`, edge.confidence);
  }

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(simLinks)
        .id((node) => node.id)
        .distance((link) => {
          const source = (link.source as SimNode).id;
          const target = (link.target as SimNode).id;
          const confidence =
            confidenceByPair.get(`${source}|${target}`) ??
            confidenceByPair.get(`${target}|${source}`) ??
            50;
          return Math.max(145, 360 - confidence * 2.1);
        })
        .strength(0.42),
    )
    .force("charge", forceManyBody<SimNode>().strength(-760))
    .force("center", forceCenter(540, 330))
    .force("collide", forceCollide<SimNode>(150))
    .stop();

  for (let index = 0; index < 420; index += 1) simulation.tick();

  const positions = new Map<string, GraphPoint>();
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
    style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
  >
    <Handle type="target" position={Position.Top} style={{ visibility: "hidden" }} />
    <Handle type="source" position={Position.Bottom} style={{ visibility: "hidden" }} />
    <span className="meaning-flow-node-type">
      {data.type.replace(/_/g, " ")}
    </span>
    <p className="meaning-flow-node-label">{data.label}</p>
    <span className="meaning-flow-node-meta">
      {data.degree} link{data.degree === 1 ? "" : "s"} · {data.evidenceCount} evidence · {data.weight} weight
    </span>
  </div>
));
MeaningFlowNode.displayName = "MeaningFlowNode";

const nodeTypes = { meaning: MeaningFlowNode };

export default function MeaningGraphPage(): JSX.Element {
  const [graph, setGraph] = useState<ApiMeaningGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [hideIsolates, setHideIsolates] = useState(false);
  const [flowNodes, setFlowNodes, onNodesChange] =
    useNodesState<MeaningNodeData>([]);

  const loadGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchMeaningGraph();
      setGraph(next);
      if (!selectedNodeId && next.nodes[0]) setSelectedNodeId(next.nodes[0].id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load meaning graph");
    } finally {
      setLoading(false);
    }
  }, [selectedNodeId]);

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const nodes = graph?.nodes ?? [];
  const edges = graph?.edges ?? [];

  const degreeById = useMemo(() => {
    const map = new Map<string, number>();
    for (const edge of edges) {
      map.set(edge.sourceNodeId, (map.get(edge.sourceNodeId) ?? 0) + 1);
      map.set(edge.targetNodeId, (map.get(edge.targetNodeId) ?? 0) + 1);
    }
    return map;
  }, [edges]);

  const visibleNodes = useMemo(
    () => nodes.filter((node) => !hideIsolates || (degreeById.get(node.id) ?? 0) > 0),
    [degreeById, hideIsolates, nodes],
  );

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  );

  const visibleEdges = useMemo(
    () =>
      edges.filter(
        (edge) => visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId),
      ),
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
    for (const edge of visibleEdges) {
      if (!map.has(edge.sourceNodeId)) map.set(edge.sourceNodeId, new Set());
      if (!map.has(edge.targetNodeId)) map.set(edge.targetNodeId, new Set());
      map.get(edge.sourceNodeId)!.add(edge.targetNodeId);
      map.get(edge.targetNodeId)!.add(edge.sourceNodeId);
    }
    return map;
  }, [visibleEdges]);

  useEffect(() => {
    if (!graph) {
      setFlowNodes([]);
      return;
    }

    const positions = runLayout(visibleNodes, visibleEdges);
    setFlowNodes(
      visibleNodes.map((node) => {
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
            weight: node.weight,
            evidenceCount: node.evidenceCount,
            degree: degreeById.get(node.id) ?? 0,
            isFocus: false,
            fade: false,
          },
          style: { width: NODE_WIDTH, height: NODE_HEIGHT },
        };
      }),
    );
  }, [degreeById, graph, setFlowNodes, visibleEdges, visibleNodes]);

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
            degree: degreeById.get(node.id) ?? 0,
          },
        };
      }),
    );
  }, [degreeById, focusNeighbors, focusNodeId, setFlowNodes]);

  const flowEdges: Edge[] = useMemo(
    () =>
      visibleEdges.map((edge) => {
        const isFocus =
          focusNodeId !== null &&
          (edge.sourceNodeId === focusNodeId || edge.targetNodeId === focusNodeId);
        const isSelected = selectedEdgeId === edge.id;
        const fade = focusNodeId !== null && !isFocus;
        const normalized = Math.max(0.2, Math.min(1, edge.confidence / 100));
        return {
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          type: "floating",
          label: isFocus || isSelected ? edgeLabel(edge.kind) : undefined,
          style: {
            stroke: edgeColor(edge.kind),
            strokeWidth: isSelected ? 3 : 0.8 + normalized * 2.8,
            opacity: fade ? 0.08 : isFocus || isSelected ? 0.78 : 0.3,
          },
          labelStyle: {
            color: edgeColor(edge.kind),
            fontSize: 10,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          },
          labelBgPadding: [5, 2] as [number, number],
          labelBgBorderRadius: 999,
          labelBgStyle: {
            background: "rgba(251, 250, 247, 0.94)",
            border: "1px solid rgba(15, 15, 14, 0.08)",
          },
          labelShowBg: true,
        };
      }),
    [focusNodeId, selectedEdgeId, visibleEdges],
  );

  return (
    <main className="meaning-graph-page">
      <header className="meaning-graph-header">
        <div>
          <span>Internal graph inspector</span>
          <h1>Meaning graph</h1>
          <p>
            Backend-only view of packetized inspirations and judged relationships.
            Drag meaning nodes, click edges, and inspect which saves became evidence.
          </p>
        </div>
        <button type="button" onClick={loadGraph} disabled={loading}>
          {loading ? "Refreshing" : "Refresh"}
        </button>
      </header>

      {error ? <p className="meaning-graph-error">{error}</p> : null}

      <section className="meaning-graph-shell meaning-graph-shell--flow">
        <div className="meaning-graph-canvas-wrap meaning-graph-flow-shell">
          <div className="meaning-graph-stats">
            <span>{graph?.meta.nodeCount ?? 0} nodes</span>
            <span>{visibleEdges.length} edges</span>
            <span>{graph?.meta.evidenceCount ?? 0} evidence</span>
            <label>
              <input
                type="checkbox"
                checked={hideIsolates}
                onChange={(event) => setHideIsolates(event.target.checked)}
              />
              hide isolates
            </label>
          </div>
          {nodes.length === 0 ? (
            <div className="meaning-graph-empty">
              <strong>No graph rows yet</strong>
              <span>
                Save/process inspirations through the meaning graph writer, then
                refresh this inspector.
              </span>
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
              <MiniMap pannable zoomable maskColor="rgba(251, 250, 247, 0.72)" />
            </ReactFlow>
          )}
        </div>

        <aside className="meaning-graph-detail">
          {selectedEdge ? (
            <EdgeDetail edge={selectedEdge} nodeById={nodeById} />
          ) : selectedNode ? (
            <NodeDetail node={selectedNode} />
          ) : (
            <div className="meaning-graph-detail-empty">
              <strong>Select a node or edge</strong>
              <span>Click the graph to inspect the persisted backend row.</span>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function NodeDetail({ node }: { node: ApiMeaningGraphNode }): JSX.Element {
  return (
    <div className="meaning-graph-detail-card">
      <span>Node {shortId(node.id)}</span>
      <h2>{node.label}</h2>
      <dl>
        <div>
          <dt>Evidence</dt>
          <dd>{node.evidenceCount}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{node.type}</dd>
        </div>
        <div>
          <dt>Weight</dt>
          <dd>{node.weight}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{node.confidence}</dd>
        </div>
        <div>
          <dt>Last reinforced</dt>
          <dd>{formatTime(node.lastReinforcedAt)}</dd>
        </div>
      </dl>
      <section>
        <h3>Description</h3>
        <p>{node.description || "No description."}</p>
      </section>
      <section>
        <h3>Evidence</h3>
        {node.evidence.length === 0 ? (
          <p>No evidence rows loaded.</p>
        ) : (
          <ul>
            {node.evidence.map((evidence) => (
              <li key={`${node.id}-${evidence.inspirationId}`}>
                <strong>{evidence.preview}</strong>
                <span> {evidence.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function EdgeDetail({
  edge,
  nodeById,
}: {
  edge: ApiMeaningGraphEdge;
  nodeById: Map<string, ApiMeaningGraphNode>;
}): JSX.Element {
  const from = nodeById.get(edge.sourceNodeId);
  const to = nodeById.get(edge.targetNodeId);
  return (
    <div className="meaning-graph-detail-card">
      <span>Edge {shortId(edge.id)}</span>
      <h2>{edge.kind}</h2>
      <dl>
        <div>
          <dt>Weight</dt>
          <dd>{edge.weight}</dd>
        </div>
        <div>
          <dt>Confidence</dt>
          <dd>{edge.confidence}</dd>
        </div>
        <div>
          <dt>From</dt>
          <dd>{from?.label ?? shortId(edge.sourceNodeId)}</dd>
        </div>
        <div>
          <dt>To</dt>
          <dd>{to?.label ?? shortId(edge.targetNodeId)}</dd>
        </div>
        <div>
          <dt>Last reinforced</dt>
          <dd>{formatTime(edge.lastReinforcedAt)}</dd>
        </div>
      </dl>
      <section>
        <h3>Relationship</h3>
        <p>
          {from?.label ?? "Unknown source"} {edgeLabel(edge.kind)} {to?.label ?? "unknown target"}.
        </p>
      </section>
      <section>
        <h3>Evidence</h3>
        <ul>
          {edge.evidenceInspirationIds.map((inspirationId) => (
            <li key={`${edge.id}-${inspirationId}`}>{shortId(inspirationId)}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
