/**
 * The graph screen — one profile's mind as a picture.
 *
 * The 2026-08-17 meeting asked to SEE what an agent has come to hold,
 * Obsidian-like: principles standing over the signals they grew from, the
 * signals over the experiences whose memories evidence them. Three columns,
 * then, because that is what the data IS — a layered derivation, not a soup
 * of associations — and a deterministic layout, because a graph that
 * re-arranges itself on every visit cannot be compared with last week's.
 *
 * Principles are set apart by color (the meeting: "프린시플 빨간색 같은 걸로
 * 색깔 좀 차이 나고"); signals carry their status in their opacity;
 * experiences sit dimmest, being ground rather than conclusion. Labels are
 * statements and names only — the endpoint never sends capture text, and
 * this screen could not print what never arrives.
 */
import { useEffect, useMemo, useState } from "react";

import { fetchGraph, type ApiGraph } from "../lib/api";
import { t, type SupportedLocale } from "../lib/locales";

export interface GraphScreenProps {
  locale: SupportedLocale;
  active: boolean;
  /** Whose mind; null is the session's own. */
  profileId: string | null;
  onBack: () => void;
}

const COLUMN_X = { principle: 90, signal: 430, experience: 800 } as const;
const ROW_H = 44;
const TOP_PAD = 30;
const LABEL_MAX = 42;

function truncate(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

export function GraphScreen({ locale, active, profileId, onBack }: GraphScreenProps): JSX.Element {
  const [graph, setGraph] = useState<ApiGraph | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    setGraph(null);
    setFailed(false);
    fetchGraph(profileId ?? undefined)
      .then(setGraph)
      .catch(() => setFailed(true));
  }, [active, profileId]);

  const layout = useMemo(() => {
    if (!graph) return null;
    const byKind = {
      principle: graph.nodes.filter((node) => node.kind === "principle"),
      signal: graph.nodes.filter((node) => node.kind === "signal"),
      experience: graph.nodes.filter((node) => node.kind === "experience"),
    };
    const position = new Map<string, { x: number; y: number }>();
    for (const kind of ["principle", "signal", "experience"] as const) {
      byKind[kind].forEach((node, index) => {
        position.set(node.id, { x: COLUMN_X[kind], y: TOP_PAD + index * ROW_H });
      });
    }
    const rows = Math.max(
      byKind.principle.length,
      byKind.signal.length,
      byKind.experience.length,
      1,
    );
    return { byKind, position, height: TOP_PAD + rows * ROW_H + 20 };
  }, [graph]);

  return (
    <div className="sf-column">
      <button type="button" className="sf-back" onClick={onBack}>
        ← back
      </button>
      <div className="pr-head">
        <div>
          <div className="pr-eyebrow">{t(locale, "graphEyebrow")}</div>
          <h2 className="pr-title">{t(locale, "graphTitle")}</h2>
        </div>
      </div>

      {failed ? <p className="pr-empty">{t(locale, "graphEmpty")}</p> : null}
      {layout && graph && graph.nodes.length === 0 ? (
        <p className="pr-empty">{t(locale, "graphEmpty")}</p>
      ) : null}

      {layout && graph && graph.nodes.length > 0 ? (
        <div className="gph-scroll">
          <svg
            className="gph-svg"
            viewBox={`0 0 860 ${layout.height}`}
            width="860"
            height={layout.height}
            role="img"
            aria-label={t(locale, "graphTitle")}
          >
            <text className="gph-col" x={COLUMN_X.principle} y={14}>
              {t(locale, "graphPrinciples")}
            </text>
            <text className="gph-col" x={COLUMN_X.signal} y={14}>
              {t(locale, "graphSignals")}
            </text>
            <text className="gph-col" x={COLUMN_X.experience} y={14}>
              {t(locale, "graphExperiences")}
            </text>

            {graph.edges.map((edge) => {
              const from = layout.position.get(edge.from);
              const to = layout.position.get(edge.to);
              if (!from || !to) return null;
              const midX = (from.x + to.x) / 2;
              return (
                <path
                  key={`${edge.from}:${edge.to}`}
                  className="gph-edge"
                  d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
                />
              );
            })}

            {graph.nodes.map((node) => {
              const at = layout.position.get(node.id);
              if (!at) return null;
              return (
                <g key={node.id} className={`gph-node gph-node--${node.kind}`}>
                  <circle cx={at.x} cy={at.y} r={5} />
                  <text
                    x={node.kind === "experience" ? at.x - 10 : at.x + 10}
                    y={at.y + 4}
                    textAnchor={node.kind === "experience" ? "end" : "start"}
                    opacity={node.status === "emerging" ? 0.55 : undefined}
                  >
                    {truncate(node.label)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : null}
    </div>
  );
}
