/**
 * <ClusterSection /> — a single cluster's section on the home grid.
 *
 * Ports the prototype's `wm-card` cluster tile from `index.html` (lines
 * 3897–3931 in `renderPhase3`) into a declarative React component while
 * preserving the exact DOM structure and CSS class contract so the
 * existing styles in `index.html` continue to apply 1:1 once they migrate
 * into `global.css`.
 *
 * In the prototype, each cluster on the 3×3 grid is built imperatively as:
 *
 *   <div class="wm-card wm-{kind}" style="--mp:..s; --dotDelay:..s">
 *     <span class="count">{count}</span>
 *     <span class="kind-name">{label}</span>
 *     <div class="wm-shape">{svgHtml}</div>
 *     <span class="description">{topic}</span>
 *     <span class="artifact">{artifact}</span>
 *     <span class="status-dot"></span>
 *   </div>
 *
 * Three responsibilities the component owns (per Sub-AC 4.3.2):
 *
 *   1. **Grouping wrapper** — the outer `wm-card` div carries the
 *      cluster-kind modifier (`wm-{kind}`), the optional `awake` modifier
 *      (entrance/hover affordance), and CSS custom properties used by the
 *      keyframe glyphs (`--mp`, `--dotDelay`).
 *   2. **Cluster header** — `count` + `kind-name` + the `wm-shape` SVG block.
 *      The header conveys *which* cluster this is (label + glyph) and
 *      *how dense* it is (count). The prototype hides `kind-name` visually
 *      via CSS but keeps it in the DOM for AT semantics; we mirror that.
 *   3. **Child card list rendering** — the `description` (cluster topic),
 *      the `artifact` (a representative excerpt from the cluster's saves),
 *      and an optional `children` slot the parent can use to mount
 *      `<InspirationCard>` rows when the section is rendered in a
 *      list-detail context (e.g. the wow-moment deep-dive / cluster-list
 *      view).
 *
 * Visual parity rule (per Sub-AC 4.3.2): identical DOM and class names.
 * The component therefore renders all six prototype spans/divs in the
 * exact order, even when the corresponding prop is omitted — empty spans
 * preserve the cascade weight and grid layout the prototype's CSS assumes.
 */

import type { ReactNode, CSSProperties, MouseEventHandler } from "react";

/**
 * Allowed cluster kinds — mirrors the ontology's `ClusterEnum` and the
 * prototype's `CANONICAL_KINDS` array (index.html line 3833).
 */
export type ClusterKind =
  | "outlier"
  | "bridge"
  | "morph"
  | "convergence"
  | "tension"
  | "loop";

export interface ClusterSectionProps {
  /** Cluster kind — drives the `wm-{kind}` modifier class. */
  kind: ClusterKind;
  /** Number of saves in this cluster. Rendered as the `.count` span. */
  count: number;
  /**
   * Behavior word for the cluster. Hidden visually by `.kind-name`'s
   * CSS but retained in the DOM for accessibility tooling. Defaults to
   * the cluster `kind` itself, matching the prototype where the label
   * was derived from `built.label`.
   */
  label?: string;
  /**
   * The cluster's topic copy — what these saves are *about*. Rendered
   * inside `.description` (italic serif in the home grid).
   */
  topic: string;
  /**
   * A representative excerpt drawn from the cluster's saves. Rendered
   * inside `.artifact` (monospace footer of the card).
   */
  artifact?: string | null;
  /**
   * Optional SVG markup for the `wm-shape` glyph. The prototype builds
   * this string via `shapeFor(...)` and injects it with `innerHTML`. We
   * accept either a `ReactNode` (preferred — pass `<svg>` JSX) or a raw
   * HTML string (fallback for parity with the prototype's loaders).
   */
  shape?: ReactNode;
  /**
   * Raw HTML alternative to `shape`. Use this when porting prototype
   * loaders that emit hand-tuned SVG strings; `shape` is preferred for
   * new code. Mutually exclusive with `shape` — `shape` wins if both set.
   */
  shapeHtml?: string;
  /**
   * Whether the card is "awake" (recently activated). Adds the `awake`
   * class which CSS uses to (a) reveal `.wm-shape`, (b) enable
   * pointer/cursor affordance, (c) gate the wake animation.
   */
  awake?: boolean;
  /**
   * CSS custom properties consumed by the prototype's glyph keyframes.
   * Forwarded as inline style. Both default to undefined so the cascade
   * uses whatever the stylesheet provides.
   *
   * - `mpDuration`  → `--mp`        (morph-period for `wm-shape` motion)
   * - `dotDelay`    → `--dotDelay`  (status-dot pulse offset)
   */
  mpDuration?: string;
  dotDelay?: string;
  /**
   * Click handler — the prototype attaches this on every cluster tile so
   * the user can open the wow-moment deep-dive. Optional so the same
   * component can be rendered as a non-interactive section in
   * non-overlay contexts.
   */
  onClick?: MouseEventHandler<HTMLDivElement>;
  /**
   * Optional child card list. When provided, rendered after the
   * `.artifact` span inside the wrapper so consumers can mount
   * `<InspirationCard>` rows under the cluster header (e.g. when the
   * cluster is shown as a deep-dive section rather than a 3×3 tile).
   * Kept opt-in because the home-grid prototype's `wm-card` has no
   * children — preserving visual parity for the default case.
   */
  children?: ReactNode;
  /** Optional escape hatch for additional className tokens. */
  className?: string;
  /**
   * Optional `data-id` for click-target tracing — mirrors the
   * `data-id` convention used on `.history-item` and lets tests
   * locate a specific cluster section.
   */
  dataId?: string;
}

/**
 * Compose the wrapper class list. Order is fixed (`wm-card` first,
 * `wm-{kind}` second, `awake` last) so it matches what the prototype
 * emits and any descendant selectors that rely on token position.
 */
function wrapperClassName(
  kind: ClusterKind,
  awake: boolean,
  extra?: string,
): string {
  const tokens = ["wm-card", `wm-${kind}`];
  if (awake) tokens.push("awake");
  if (extra) tokens.push(extra);
  return tokens.join(" ");
}

export function ClusterSection({
  kind,
  count,
  label,
  topic,
  artifact,
  shape,
  shapeHtml,
  awake = false,
  mpDuration,
  dotDelay,
  onClick,
  children,
  className,
  dataId,
}: ClusterSectionProps): JSX.Element {
  // Forward CSS custom props the prototype's glyph keyframes consume.
  // Cast through `Record<string, string>` because TS's CSSProperties type
  // doesn't index `--*` vars by default.
  const style: CSSProperties = {};
  if (mpDuration) (style as Record<string, string>)["--mp"] = mpDuration;
  if (dotDelay) (style as Record<string, string>)["--dotDelay"] = dotDelay;

  // `kind-name` is hidden visually by the prototype CSS but retained in
  // the DOM. Default the label to the cluster kind so the AT-readable
  // text is never empty.
  const headerLabel = label ?? kind;

  // The prototype passes the SVG glyph as raw HTML. Prefer the React
  // node form when given; fall back to `dangerouslySetInnerHTML` only
  // when the consumer explicitly opts in via `shapeHtml`.
  const hasShape = shape !== undefined || (shapeHtml && shapeHtml.length > 0);

  return (
    <div
      className={wrapperClassName(kind, awake, className)}
      style={style}
      onClick={onClick}
      data-id={dataId}
    >
      {/* --- Cluster header: count, kind label, glyph --- */}
      <span className="count">{count}</span>
      <span className="kind-name">{headerLabel}</span>
      {hasShape ? (
        shape !== undefined ? (
          <div className="wm-shape">{shape}</div>
        ) : (
          <div
            className="wm-shape"
            // shapeHtml is consumer-supplied prototype SVG markup — the
            // home-grid prototype emits this same way. Safe because the
            // string originates from the application's own glyph
            // builder, not user input.
            dangerouslySetInnerHTML={{ __html: shapeHtml ?? "" }}
          />
        )
      ) : null}

      {/* --- Description / artifact: topic + representative excerpt --- */}
      <span className="description">{topic}</span>
      <span className="artifact">{artifact ?? ""}</span>

      {/* --- Status dot — present in DOM, styled away on the home grid --- */}
      <span className="status-dot" />

      {/*
        Optional child-card list slot. Rendered last so the prototype's
        flex column layout (`count → description → artifact at bottom`)
        is preserved when no children are supplied — i.e. visual parity
        for the default home-grid tile is byte-identical with the
        prototype DOM. Consumers that need a real list (e.g. cluster
        deep-dive) opt in by passing `<InspirationCard>` children.
      */}
      {children}
    </div>
  );
}

export default ClusterSection;
