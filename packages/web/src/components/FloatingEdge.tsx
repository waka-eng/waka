import { useCallback, type CSSProperties } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getStraightPath,
  useStore,
} from "reactflow";

interface Center {
  x: number;
  y: number;
}

function rectIntersection(
  cx: number,
  cy: number,
  width: number,
  height: number,
  toX: number,
  toY: number,
): Center {
  const dx = toX - cx;
  const dy = toY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const tx = Math.abs(dx) === 0 ? Infinity : width / 2 / Math.abs(dx);
  const ty = Math.abs(dy) === 0 ? Infinity : height / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
}

export function FloatingEdge(props: EdgeProps): JSX.Element | null {
  const {
    id,
    source,
    target,
    style,
    label,
    labelStyle,
    labelBgStyle,
    labelBgPadding,
    labelBgBorderRadius,
  } = props;

  const sourceNode = useStore(
    useCallback((state) => state.nodeInternals.get(source), [source]),
  );
  const targetNode = useStore(
    useCallback((state) => state.nodeInternals.get(target), [target]),
  );

  if (!sourceNode || !targetNode) return null;

  const sourcePosition = sourceNode.positionAbsolute ?? sourceNode.position;
  const targetPosition = targetNode.positionAbsolute ?? targetNode.position;
  const sourceWidth = sourceNode.width ?? 220;
  const sourceHeight = sourceNode.height ?? 96;
  const targetWidth = targetNode.width ?? 220;
  const targetHeight = targetNode.height ?? 96;

  const sourceCenter = {
    x: sourcePosition.x + sourceWidth / 2,
    y: sourcePosition.y + sourceHeight / 2,
  };
  const targetCenter = {
    x: targetPosition.x + targetWidth / 2,
    y: targetPosition.y + targetHeight / 2,
  };

  const sourceExit = rectIntersection(
    sourceCenter.x,
    sourceCenter.y,
    sourceWidth,
    sourceHeight,
    targetCenter.x,
    targetCenter.y,
  );
  const targetEntry = rectIntersection(
    targetCenter.x,
    targetCenter.y,
    targetWidth,
    targetHeight,
    sourceCenter.x,
    sourceCenter.y,
  );

  const [path, labelX, labelY] = getStraightPath({
    sourceX: sourceExit.x,
    sourceY: sourceExit.y,
    targetX: targetEntry.x,
    targetY: targetEntry.y,
  });

  return (
    <>
      <BaseEdge id={id} path={path} style={style} />
      {label ? (
        <EdgeLabelRenderer>
          <div
            className="floating-edge-label"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              padding:
                Array.isArray(labelBgPadding) && labelBgPadding.length === 2
                  ? `${labelBgPadding[1]}px ${labelBgPadding[0]}px`
                  : "1px 3px",
              borderRadius: labelBgBorderRadius ?? 2,
              ...(labelBgStyle as CSSProperties | undefined),
              ...(labelStyle as CSSProperties | undefined),
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

