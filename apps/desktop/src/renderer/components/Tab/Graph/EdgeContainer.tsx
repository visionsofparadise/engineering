import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "@xyflow/react";
import { Plus } from "lucide-react";

interface AudioEdgeData {
  readonly state: "idle" | "active" | "complete";
  [key: string]: unknown;
}

const EDGE_COLORS: Record<string, string> = {
  idle: "var(--color-edge-idle)",
  active: "var(--color-edge-active)",
  complete: "var(--color-edge-complete)",
};

export function EdgeContainer({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const edgeData = data as unknown as AudioEdgeData | undefined;
  const state = edgeData?.state ?? "idle";
  const color = EDGE_COLORS[state] ?? EDGE_COLORS.idle;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const isActive = state === "active";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: 1.5,
          ...(isActive
            ? {
                strokeDasharray: "6 4",
                animation: "dash-flow 0.8s linear infinite",
              }
            : {}),
        }}
      />
      <EdgeLabelRenderer>
        <button
          className="nodrag nopan flex items-center justify-center bg-chrome-raised py-1 mx-1 text-chrome-text-dim hover:text-chrome-text-secondary"
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
        >
          <Plus size={12} />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
