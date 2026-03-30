import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface ApplyInput {
	source: string;
	transforms: Array<{ package: string; node: string; options?: Record<string, unknown> }>;
	target: string;
	encoding?: { format: string; bitDepth?: number; sampleRate?: number };
}

export type ApplyIpcParameters = [input: ApplyInput];
export interface ApplyIpcReturn { jobId: string }
export const APPLY_ACTION = "audioApply" as const;

export class ApplyRendererIpc extends AsyncRendererIpc<typeof APPLY_ACTION, ApplyIpcParameters, ApplyIpcReturn> {
	action = APPLY_ACTION;
}
