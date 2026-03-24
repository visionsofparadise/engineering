import type { Node, Edge } from "@xyflow/react";

type NodeState = "rendered" | "stale" | "processing" | "error" | "bypassed";
type NodeCategory = "source" | "transform" | "target";

interface NumberParameter {
  readonly kind: "number";
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
}

interface BooleanParameter {
  readonly kind: "boolean";
  readonly name: string;
  readonly value: boolean;
}

interface EnumParameter {
  readonly kind: "enum";
  readonly name: string;
  readonly value: string;
  readonly options: ReadonlyArray<string>;
}

interface StringParameter {
  readonly kind: "string";
  readonly name: string;
  readonly value: string;
}

type Parameter = NumberParameter | BooleanParameter | EnumParameter | StringParameter;

interface AudioNodeData {
  readonly label: string;
  readonly category: NodeCategory;
  readonly state: NodeState;
  readonly bypassed: boolean;
  readonly parameters: ReadonlyArray<Parameter>;
  [key: string]: unknown;
}

const COL_0 = 0;
const COL_1 = 300;
const COL_2 = 600;
const COL_3 = 900;
const COL_4 = 1200;
const ROW_GAP = 250;

const demoNodes: Array<Node<AudioNodeData>> = [
  {
    id: "read",
    type: "audioNode",
    position: { x: COL_0, y: 0 },
    data: {
      label: "Read",
      category: "source",
      state: "rendered",
      bypassed: false,
      parameters: [
        { kind: "string", name: "sources", value: "podcast-raw.wav\ninterview-backup.wav" },
      ],
    },
  },
  {
    id: "denoise",
    type: "audioNode",
    position: { x: COL_1, y: 0 },
    data: {
      label: "Voice Denoise",
      category: "transform",
      state: "rendered",
      bypassed: false,
      parameters: [
        { kind: "number", name: "threshold", value: -30, min: -60, max: 0, step: 1, unit: "dB" },
        { kind: "number", name: "reduction", value: 12, min: 0, max: 40, step: 1, unit: "dB" },
      ],
    },
  },
  {
    id: "loudness",
    type: "audioNode",
    position: { x: COL_1, y: ROW_GAP },
    data: {
      label: "Loudness Stats",
      category: "target",
      state: "rendered",
      bypassed: false,
      parameters: [
        { kind: "number", name: "window", value: 3, min: 0.1, max: 10, step: 0.1, unit: "s" },
      ],
    },
  },
  {
    id: "declick",
    type: "audioNode",
    position: { x: COL_2, y: 0 },
    data: {
      label: "De-Click",
      category: "transform",
      state: "processing",
      bypassed: false,
      parameters: [
        { kind: "number", name: "sensitivity", value: 0.5, min: 0, max: 1, step: 0.01, unit: "" },
        { kind: "enum", name: "frequency", value: "auto", options: ["auto", "low", "mid", "high"] },
      ],
    },
  },
  {
    id: "eq",
    type: "audioNode",
    position: { x: COL_2, y: ROW_GAP },
    data: {
      label: "EQ",
      category: "transform",
      state: "bypassed",
      bypassed: true,
      parameters: [
        { kind: "number", name: "lowCut", value: 80, min: 20, max: 500, step: 1, unit: "Hz" },
        { kind: "number", name: "highCut", value: 16000, min: 1000, max: 20000, step: 100, unit: "Hz" },
      ],
    },
  },
  {
    id: "normalize",
    type: "audioNode",
    position: { x: COL_3, y: 0 },
    data: {
      label: "Normalize",
      category: "transform",
      state: "stale",
      bypassed: false,
      parameters: [
        { kind: "number", name: "ceiling", value: -1, min: -12, max: 0, step: 0.1, unit: "dB" },
        { kind: "enum", name: "algorithm", value: "peak", options: ["peak", "rms", "lufs"] },
      ],
    },
  },
  {
    id: "write",
    type: "audioNode",
    position: { x: COL_4, y: 0 },
    data: {
      label: "Write",
      category: "target",
      state: "stale",
      bypassed: false,
      parameters: [
        { kind: "string", name: "path", value: "podcast-clean.wav" },
        { kind: "number", name: "bitDepth", value: 24, min: 16, max: 32, step: 8, unit: "bit" },
      ],
    },
  },
];

interface AudioEdgeData {
  readonly state: "idle" | "active" | "complete";
  [key: string]: unknown;
}

const demoEdges: Array<Edge<AudioEdgeData>> = [
  { id: "e-read-denoise", source: "read", target: "denoise", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "complete" } },
  { id: "e-denoise-declick", source: "denoise", target: "declick", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "active" } },
  { id: "e-declick-normalize", source: "declick", target: "normalize", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "idle" } },
  { id: "e-normalize-write", source: "normalize", target: "write", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "idle" } },
  { id: "e-read-loudness", source: "read", target: "loudness", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "complete" } },
  { id: "e-denoise-eq", source: "denoise", target: "eq", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "idle" } },
];

export { demoNodes, demoEdges };
export type { AudioNodeData, AudioEdgeData, Parameter, NumberParameter, NodeState, NodeCategory };
