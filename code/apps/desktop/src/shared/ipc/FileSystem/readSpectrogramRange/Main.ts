import fs from "node:fs/promises";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { READ_SPECTROGRAM_RANGE_ACTION, type ReadSpectrogramRangeIpcParameters, type ReadSpectrogramRangeIpcReturn } from "./Renderer";

const HEADER_SIZE = 33;

export class ReadSpectrogramRangeMainIpc extends AsyncMainIpc<ReadSpectrogramRangeIpcParameters, ReadSpectrogramRangeIpcReturn> {
	action = READ_SPECTROGRAM_RANGE_ACTION;

	async handler(
		path: string,
		channel: number,
		startFrame: number,
		endFrame: number,
		stride: number,
		numBins: number,
		channels: number,
		_dependencies: IpcHandlerDependencies,
	): Promise<ReadSpectrogramRangeIpcReturn> {
		const handle = await fs.open(path, "r");

		try {
			const frameSize = channels * numBins * 4;
			const channelOffset = channel * numBins * 4;
			const totalFrames = endFrame - startFrame;

			const totalBytes = totalFrames * frameSize;
			const buffer = Buffer.alloc(totalBytes);
			const fileOffset = HEADER_SIZE + startFrame * frameSize;
			await handle.read(buffer, 0, totalBytes, fileOffset);

			const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

			if (stride === 1) {
				const result = new Float32Array(totalFrames * numBins);

				for (let fi = 0; fi < totalFrames; fi++) {
					const offset = fi * frameSize + channelOffset;
					for (let bin = 0; bin < numBins; bin++) {
						result[fi * numBins + bin] = view.getFloat32(offset + bin * 4, true);
					}
				}

				return result;
			}

			const outputFrameCount = Math.ceil(totalFrames / stride);
			const result = new Float32Array(outputFrameCount * numBins);

			for (let oi = 0; oi < outputFrameCount; oi++) {
				const windowStart = oi * stride;
				const windowEnd = Math.min(windowStart + stride, totalFrames);
				const outOffset = oi * numBins;

				for (let bin = 0; bin < numBins; bin++) {
					let maxMag = 0;

					for (let fi = windowStart; fi < windowEnd; fi++) {
						const mag = view.getFloat32(fi * frameSize + channelOffset + bin * 4, true);
						if (mag > maxMag) maxMag = mag;
					}

					result[outOffset + bin] = maxMag;
				}
			}

			return result;
		} finally {
			await handle.close();
		}
	}
}
