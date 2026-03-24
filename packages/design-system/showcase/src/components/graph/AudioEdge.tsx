import { BaseEdge, getBezierPath, type EdgeProps } from "@xyflow/react";
import type { AudioEdgeData } from "../../data/demoGraph";

const EDGE_COLORS: Record<string, string> = {
  idle: "var(--color-edge-idle)",
  active: "var(--color-edge-active)",
  complete: "var(--color-edge-complete)",
};

export function AudioEdge({
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

  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const isActive = state === "active";

  return (
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
  );
}
