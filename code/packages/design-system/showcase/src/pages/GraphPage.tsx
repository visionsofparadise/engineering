import { useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
  type Node,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AudioNode } from "../components/graph/AudioNode";
import { AudioEdge } from "../components/graph/AudioEdge";
import { NodeContextMenu } from "../components/graph/NodeContextMenu";
import { demoNodes, demoEdges } from "../data/demoGraph";

const NODE_TYPES: NodeTypes = { audioNode: AudioNode };
const EDGE_TYPES: EdgeTypes = { audioEdge: AudioEdge };

interface ContextMenuState {
  readonly x: number;
  readonly y: number;
}

export function GraphPage() {
  const [nodes, , onNodesChange] = useNodesState(demoNodes);
  const [edges, , onEdgesChange] = useEdgesState(demoEdges);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const handleNodeContextMenu: NodeMouseHandler<Node> = useCallback((event, _node) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const handlePaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handlePaneClick = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div
      className="relative h-full w-full"
      onContextMenu={handleContextMenu}
    >
      <style>{`
        .react-flow {
          --xy-background-color: var(--chrome-base);
          --xy-node-border-radius: 0;
          --xy-node-boxshadow-default: none;
          --xy-node-boxshadow-hover: none;
          --xy-node-boxshadow-selected: none;
          --xy-minimap-background: var(--chrome-surface);
          --xy-minimap-mask-background: var(--chrome-base);
          --xy-controls-button-background: var(--chrome-raised);
          --xy-controls-button-color: var(--chrome-text);
          --xy-controls-button-border-color: transparent;
          --xy-edge-stroke-default: var(--edge-idle);
          --xy-handle-background: var(--chrome-surface);
          --xy-handle-border-color: transparent;
          --xy-selection-background: var(--data-selection);
          --xy-selection-border: none;
        }

        .react-flow .react-flow__controls {
          border: none;
          border-radius: 0;
          box-shadow: none;
          background: var(--chrome-raised);
        }

        .react-flow .react-flow__controls button {
          background: var(--chrome-raised);
          border: none;
          border-radius: 0;
          width: 28px;
          height: 28px;
          padding: 4px;
        }

        .react-flow .react-flow__controls button:hover {
          background: var(--interactive-hover);
        }

        .react-flow .react-flow__controls svg {
          fill: var(--chrome-text);
        }

        .react-flow .react-flow__minimap {
          border: none;
          border-radius: 0;
          box-shadow: none;
          background: var(--chrome-surface);
        }

        .react-flow .react-flow__node {
          border-radius: 0;
          box-shadow: none;
          padding: 0;
        }

        .react-flow .react-flow__attribution {
          display: none;
        }

        @keyframes pulse-header {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        @keyframes dash-flow {
          from { stroke-dashoffset: 10; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneContextMenu={handlePaneContextMenu}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        defaultEdgeOptions={{ type: "audioEdge" }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--chrome-border-subtle)"
        />
        <MiniMap
          nodeColor="var(--chrome-raised)"
          nodeStrokeColor="var(--chrome-border-subtle)"
          nodeStrokeWidth={1}
          maskColor="var(--chrome-base)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>

      {contextMenu && (
        <NodeContextMenu
          position={contextMenu}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
