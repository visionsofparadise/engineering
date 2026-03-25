import type { Node, Edge } from "@xyflow/react";
import type { AudioNodeData, Parameter, NumberParameter, NodeState, NodeCategory } from "@engineering/design-system";

interface AudioEdgeData {
  readonly state: "idle" | "active" | "complete";
  [key: string]: unknown;
}

const COL_0 = 0;
const COL_1 = 400;
const COL_2 = 800;
const COL_3 = 1200;
const COL_4 = 1600;
const COL_5 = 2000;
const COL_6 = 2400;
const ROW_GAP = 200;

const demoNodes: Array<Node<AudioNodeData>> = [
  // Sources
  {
    id: "read-podcast",
    type: "audioNode",
    position: { x: COL_0, y: 0 },
    data: {
      label: "Read",
      description: "Read audio from a file",
      category: "source",
      state: "rendered",
      bypassed: false,
      inspected: true,
      snapshot: true,
      parameters: [
        { kind: "string", name: "path", value: "podcast-raw.wav" },
      ],
    },
  },
  {
    id: "read-interview",
    type: "audioNode",
    position: { x: COL_0, y: ROW_GAP },
    data: {
      label: "Read",
      description: "Read audio from a file",
      category: "source",
      state: "rendered",
      bypassed: false,
      snapshot: true,
      parameters: [
        { kind: "string", name: "path", value: "interview-backup.wav" },
      ],
    },
  },
  {
    id: "read-voiceover",
    type: "audioNode",
    position: { x: COL_0, y: ROW_GAP * 2 },
    data: {
      label: "Read",
      description: "Read audio from a file",
      category: "source",
      state: "stale",
      bypassed: false,
      snapshot: true,
      parameters: [
        { kind: "string", name: "path", value: "voiceover-take3.wav" },
      ],
    },
  },
  // Chain: Loudness Control
  {
    id: "loudness",
    type: "audioNode",
    position: { x: COL_1, y: 0 },
    data: {
      label: "Loudness Control",
      description: "Measure integrated, short-term, and momentary loudness",
      category: "transform",
      state: "rendered",
      bypassed: false,
      snapshot: true,
      parameters: [
        { kind: "number", name: "Target", value: -14, min: -50, max: 0, step: 0.1, unit: "dB" },
        { kind: "number", name: "True Peak", value: -1, min: -10, max: 0, step: 0.1, unit: "dB" },
        { kind: "number", name: "LRA", value: 0, min: 0, max: 20, step: 0.1, unit: "dB" },
      ],
    },
  },
  // Chain: Mouth De-Click
  {
    id: "declick",
    type: "audioNode",
    position: { x: COL_2, y: 0 },
    data: {
      label: "Mouth De-Click",
      description: "Remove clicks, pops, and impulse artifacts",
      category: "transform",
      state: "error",
      bypassed: false,
      snapshot: true,
      error: "Click detection failed: insufficient silence frames for noise profile",
      parameters: [
        { kind: "number", name: "Sensitivity", value: 0.7, min: 0, max: 1, step: 0.01, unit: "" },
        { kind: "number", name: "Max Click Duration", value: 50, min: 1, max: 1000, step: 1, unit: "smp" },
      ],
    },
  },
  // Chain: Breath Control
  {
    id: "breath",
    type: "audioNode",
    position: { x: COL_3, y: 0 },
    data: {
      label: "Breath Control",
      description: "Attenuate or remove breath sounds between phrases",
      category: "transform",
      state: "processing",
      bypassed: false,
      snapshot: true,
      progress: 0.64,
      parameters: [
        { kind: "number", name: "Sensitivity", value: 0.5, min: 0, max: 1, step: 0.01, unit: "" },
        { kind: "number", name: "Reduction", value: -12, min: -60, max: 0, step: 1, unit: "dB" },
        { kind: "enum", name: "Mode", value: "attenuate", options: ["remove", "attenuate"] },
      ],
    },
  },
  // Chain: Dialogue De-Reverb
  {
    id: "dereverb",
    type: "audioNode",
    position: { x: COL_4, y: 0 },
    data: {
      label: "Dialogue De-Reverb",
      description: "Reduce room reverb using Weighted Prediction Error",
      category: "transform",
      state: "bypassed",
      bypassed: true,
      parameters: [
        { kind: "number", name: "Prediction Delay", value: 4, min: 1, max: 10, step: 1, unit: "" },
        { kind: "number", name: "Filter Length", value: 12, min: 5, max: 30, step: 1, unit: "" },
        { kind: "number", name: "Iterations", value: 4, min: 1, max: 10, step: 1, unit: "" },
      ],
    },
  },
  // Chain: Voice Denoise
  {
    id: "denoise",
    type: "audioNode",
    position: { x: COL_5, y: 0 },
    data: {
      label: "Voice Denoise",
      description: "Remove background noise using DTLN neural network",
      category: "transform",
      state: "pending",
      bypassed: false,
      parameters: [],
    },
  },
  // Target
  {
    id: "write",
    type: "audioNode",
    position: { x: COL_6, y: 0 },
    data: {
      label: "Write",
      description: "Write audio to a file",
      category: "target",
      state: "pending",
      bypassed: false,
      parameters: [
        { kind: "string", name: "path", value: "podcast-clean.wav" },
        { kind: "enum", name: "Bit Depth", value: "24", options: ["16", "24", "32", "32f"] },
      ],
    },
  },
];

const demoEdges: Array<Edge<AudioEdgeData>> = [
  // Source connections
  { id: "e-podcast-loudness", source: "read-podcast", target: "loudness", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "complete" } },
  { id: "e-interview-loudness", source: "read-interview", target: "loudness", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "complete" } },
  { id: "e-voiceover-loudness", source: "read-voiceover", target: "loudness", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "idle" } },
  // Chain
  { id: "e-loudness-declick", source: "loudness", target: "declick", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "complete" } },
  { id: "e-declick-breath", source: "declick", target: "breath", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "active" } },
  { id: "e-breath-dereverb", source: "breath", target: "dereverb", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "idle" } },
  { id: "e-dereverb-denoise", source: "dereverb", target: "denoise", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "idle" } },
  { id: "e-denoise-write", source: "denoise", target: "write", sourceHandle: "source", targetHandle: "target", type: "audioEdge", data: { state: "idle" } },
];

export { demoNodes, demoEdges };
export type { AudioNodeData, AudioEdgeData, Parameter, NumberParameter, NodeState, NodeCategory };
