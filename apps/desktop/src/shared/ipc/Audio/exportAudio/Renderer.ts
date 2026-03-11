import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface ExportAudioInput {
	readonly sourcePath: string;
	readonly targetPath: string;
	readonly format: "wav" | "flac" | "mp3" | "aac";
	readonly bitDepth?: "16" | "24" | "32" | "32f";
	readonly bitrate?: string;
	readonly vbr?: number;
}

export type ExportAudioIpcParameters = [input: ExportAudioInput];
export type ExportAudioIpcReturn = string;
export const EXPORT_AUDIO_ACTION = "audioExport" as const;

export class ExportAudioRendererIpc extends AsyncRendererIpc<typeof EXPORT_AUDIO_ACTION, ExportAudioIpcParameters, ExportAudioIpcReturn> {
	action = EXPORT_AUDIO_ACTION;
}
