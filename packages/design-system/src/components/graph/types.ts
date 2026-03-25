export type NodeState = "rendered" | "stale" | "processing" | "pending" | "error" | "bypassed";
export type NodeCategory = "source" | "transform" | "target";

export interface NumberParameter {
  readonly kind: "number";
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly unit: string;
}

export interface BooleanParameter {
  readonly kind: "boolean";
  readonly name: string;
  readonly value: boolean;
}

export interface EnumParameter {
  readonly kind: "enum";
  readonly name: string;
  readonly value: string;
  readonly options: ReadonlyArray<string>;
}

export interface StringParameter {
  readonly kind: "string";
  readonly name: string;
  readonly value: string;
}

export type Parameter = NumberParameter | BooleanParameter | EnumParameter | StringParameter;

export interface AudioNodeData {
  readonly label: string;
  readonly category: NodeCategory;
  readonly state: NodeState;
  readonly bypassed: boolean;
  readonly parameters: ReadonlyArray<Parameter>;
  /** This source node is the one being inspected */
  readonly inspected?: boolean;
  /** Whether this node should display a snapshot waveform */
  readonly snapshot?: boolean;
  /** Short module description */
  readonly description?: string;
  /** Error message to display */
  readonly error?: string;
  /** Processing progress 0-1 */
  readonly progress?: number;
  [key: string]: unknown;
}
