import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type ReadSpectrogramRangeIpcParameters = [path: string, channel: number, startFrame: number, endFrame: number, stride: number, numBins: number, channels: number];
export type ReadSpectrogramRangeIpcReturn = Float32Array;
export const READ_SPECTROGRAM_RANGE_ACTION = "readSpectrogramRange" as const;

export class ReadSpectrogramRangeRendererIpc extends AsyncRendererIpc<typeof READ_SPECTROGRAM_RANGE_ACTION, ReadSpectrogramRangeIpcParameters, ReadSpectrogramRangeIpcReturn> {
	action = READ_SPECTROGRAM_RANGE_ACTION;
}
