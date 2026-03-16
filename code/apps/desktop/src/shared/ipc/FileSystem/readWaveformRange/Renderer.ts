import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type ReadWaveformRangeIpcParameters = [path: string, channel: number, startPoint: number, endPoint: number, stride: number, channels: number];
export type ReadWaveformRangeIpcReturn = Float32Array;
export const READ_WAVEFORM_RANGE_ACTION = "readWaveformRange" as const;

export class ReadWaveformRangeRendererIpc extends AsyncRendererIpc<typeof READ_WAVEFORM_RANGE_ACTION, ReadWaveformRangeIpcParameters, ReadWaveformRangeIpcReturn> {
	action = READ_WAVEFORM_RANGE_ACTION;
}
