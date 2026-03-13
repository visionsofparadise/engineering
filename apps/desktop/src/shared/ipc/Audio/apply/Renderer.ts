import type { ChainModuleReference } from "@engineering/acm";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface ApplyInput {
	readonly sourcePath: string;
	readonly targetPath: string;
	readonly transforms: ReadonlyArray<ChainModuleReference>;
	readonly sourceChannels?: ReadonlyArray<number>;
	readonly sourceOffset?: number;
	readonly sourceLength?: number;
	readonly encoding?: {
		readonly format: "wav" | "flac" | "mp3" | "aac";
		readonly bitrate?: string;
		readonly vbr?: number;
	};
	readonly bitDepth?: "16" | "24" | "32" | "32f";
	readonly waveform?: { readonly path: string };
	readonly spectrogram?: { readonly path: string; readonly frequencyScale?: string };
}

export type ApplyIpcParameters = [input: ApplyInput];
export type ApplyIpcReturn = string;
export const APPLY_ACTION = "audioApply" as const;

export class ApplyRendererIpc extends AsyncRendererIpc<typeof APPLY_ACTION, ApplyIpcParameters, ApplyIpcReturn> {
	action = APPLY_ACTION;
}
