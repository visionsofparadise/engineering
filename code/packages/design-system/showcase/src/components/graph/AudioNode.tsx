import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useRef, useEffect, type RefObject } from "react";
import { Icon } from "@iconify/react";
import { Knob } from "../controls/Knob";
import type { AudioNodeData, Parameter, NumberParameter } from "../../data/demoGraph";

function formatValue(param: Parameter): string {
  switch (param.kind) {
    case "number":
      return param.unit ? `${param.value} ${param.unit}` : String(param.value);
    case "boolean":
      return param.value ? "ON" : "OFF";
    case "enum":
      return param.value;
    case "string":
      return param.value;
  }
}

function NodeKnob({ param }: { readonly param: NumberParameter }) {
  const normalized = (param.value - param.min) / (param.max - param.min);

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
        {param.name}
      </span>
      <div className="flex items-center gap-2">
        <Knob value={normalized} label="" size={32} hideValue />
        <span className="font-technical text-[length:var(--text-xs)] tabular-nums text-chrome-text">
          {param.value}{param.unit ? ` ${param.unit}` : ""}
        </span>
      </div>
    </div>
  );
}

function WaveformThumbnail({ canvasRef }: { readonly canvasRef: RefObject<HTMLCanvasElement | null> }) {
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const context = canvas.getContext("2d");

    if (!context) return;

    const width = canvas.width;
    const height = canvas.height;

    context.clearRect(0, 0, width, height);

    context.fillStyle = "#0D0D0F";
    context.fillRect(0, 0, width, height);

    context.strokeStyle = "#C8C8D0";
    context.lineWidth = 1;
    context.beginPath();

    const midY = height / 2;
    const samples = 80;

    for (let index = 0; index < samples; index++) {
      const xPos = (index / samples) * width;
      const phase = (index / samples) * Math.PI * 6;
      const amplitude = Math.sin(phase) * (0.3 + 0.4 * Math.sin(index * 0.15)) * (midY - 2);

      if (index === 0) {
        context.moveTo(xPos, midY + amplitude);
      } else {
        context.lineTo(xPos, midY + amplitude);
      }
    }

    context.stroke();
  }, [canvasRef]);

  return (
    <canvas
      ref={canvasRef}
      width={200}
      height={32}
      className="block w-full bg-chrome-base"
      style={{ height: "32px" }}
    />
  );
}

function PreviewWaveform({ label }: { readonly label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  return (
    <div className="flex flex-col gap-1">
      <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim truncate">
        {label}
      </span>
      <WaveformThumbnail canvasRef={canvasRef} />
    </div>
  );
}

function PreviewSection({ sources }: { readonly sources: ReadonlyArray<string> }) {
  return (
    <div className="flex flex-col gap-2 bg-chrome-base/60 px-3 py-2">
      {sources.map((source) => (
        <PreviewWaveform key={source} label={source} />
      ))}
    </div>
  );
}

export function AudioNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as AudioNodeData;
  const isBypassed = nodeData.bypassed;
  const hasInput = nodeData.category !== "source";
  const hasOutput = nodeData.category !== "target";

  const sourcePaths: Array<string> = [];

  for (const param of nodeData.parameters) {
    if (param.kind === "string" && param.name === "sources") {
      sourcePaths.push(...param.value.split("\n").filter(Boolean));
    }
  }

  const previewLabels = sourcePaths.length > 0 ? sourcePaths : (hasOutput ? ["output"] : []);

  const numberParams = nodeData.parameters.filter((param): param is NumberParameter => param.kind === "number");
  const otherParams = nodeData.parameters.filter((param) => param.kind !== "number");

  return (
    <div className="relative">
      <div
        className={`bg-chrome-surface ${selected ? "ring-1 ring-interactive-focus" : ""}`}
        style={{ minWidth: 200 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 pt-2 pb-1">
          <span
            className={`font-body text-[length:var(--text-base)] font-medium ${isBypassed ? "text-chrome-text-dim" : "text-chrome-text"}`}
          >
            {nodeData.label}
          </span>
          <button
            className={`flex items-center justify-center py-1 mx-1 bg-chrome-raised ${isBypassed ? "text-state-bypassed" : "text-chrome-text-dim hover:text-chrome-text-secondary"}`}
          >
            <Icon icon="lucide:power" width={14} height={14} />
          </button>
        </div>

        {/* Non-number parameters */}
        {otherParams.length > 0 && (
          <div className="px-3 pb-2">
            {otherParams.map((param) => (
              <div key={param.name} className="flex flex-col gap-0.5 py-0.5">
                {param.kind === "string" ? (
                  <div className="flex flex-col gap-1">
                    <span className={`font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] ${isBypassed ? "text-chrome-text-dim" : "text-chrome-text-secondary"}`}>
                      {param.name}
                    </span>
                    <input
                      type="text"
                      defaultValue={param.value}
                      className="w-full bg-chrome-base px-2 py-1.5 font-technical text-[length:var(--text-sm)] text-chrome-text outline-none"
                    />
                  </div>
                ) : param.kind === "enum" ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className={`font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] ${isBypassed ? "text-chrome-text-dim" : "text-chrome-text-secondary"}`}>
                      {param.name}
                    </span>
                    <button
                      type="button"
                      className="flex items-center gap-0.5 bg-chrome-raised font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text"
                    >
                      <span>{param.value}</span>
                      <Icon icon="lucide:chevron-down" width={10} height={10} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-baseline justify-between gap-3">
                    <span className={`font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] ${isBypassed ? "text-chrome-text-dim" : "text-chrome-text-secondary"}`}>
                      {param.name}
                    </span>
                    <span className={`font-technical text-[length:var(--text-sm)] tabular-nums whitespace-nowrap ${isBypassed ? "text-chrome-text-dim" : "text-chrome-text"}`}>
                      {formatValue(param)}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Number parameters as knobs — label left, knob+value right */}
        {numberParams.length > 0 && (
          <div className="flex flex-col gap-2 px-3 pb-2">
            {numberParams.map((param) => (
              <NodeKnob key={param.name} param={param} />
            ))}
          </div>
        )}

        {/* Ports */}
        {hasInput && (
          <Handle
            type="target"
            position={Position.Left}
            id="target"
            className="!bg-chrome-text-dim !border-0 !w-2 !h-2"
            style={{ left: -4 }}
          />
        )}
        {hasOutput && (
          <Handle
            type="source"
            position={Position.Right}
            id="source"
            className="!bg-chrome-text-dim !border-0 !w-2 !h-2"
            style={{ right: -4 }}
          />
        )}
      </div>

      {/* Preview section */}
      {previewLabels.length > 0 && (
        <div className="mt-2">
          <PreviewSection sources={previewLabels} />
        </div>
      )}
    </div>
  );
}
