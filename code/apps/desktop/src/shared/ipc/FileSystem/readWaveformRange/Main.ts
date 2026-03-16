import fs from "node:fs/promises";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { READ_WAVEFORM_RANGE_ACTION, type ReadWaveformRangeIpcParameters, type ReadWaveformRangeIpcReturn } from "./Renderer";

const HEADER_SIZE = 16;

export class ReadWaveformRangeMainIpc extends AsyncMainIpc<ReadWaveformRangeIpcParameters, ReadWaveformRangeIpcReturn> {
	action = READ_WAVEFORM_RANGE_ACTION;

	async handler(
		path: string,
		channel: number,
		startPoint: number,
		endPoint: number,
		stride: number,
		channels: number,
		_dependencies: IpcHandlerDependencies,
	): Promise<ReadWaveformRangeIpcReturn> {
		const handle = await fs.open(path, "r");

		try {
			const pointSize = channels * 2 * 4;
			const channelOffset = channel * 2 * 4;
			const totalPoints = endPoint - startPoint;

			const totalBytes = totalPoints * pointSize;
			const buffer = Buffer.alloc(totalBytes);
			const fileOffset = HEADER_SIZE + startPoint * pointSize;
			await handle.read(buffer, 0, totalBytes, fileOffset);

			const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

			if (stride === 1) {
				const result = new Float32Array(totalPoints * 2);

				for (let pi = 0; pi < totalPoints; pi++) {
					const offset = pi * pointSize + channelOffset;
					result[pi * 2] = view.getFloat32(offset, true);
					result[pi * 2 + 1] = view.getFloat32(offset + 4, true);
				}

				return result;
			}

			const outputPointCount = Math.ceil(totalPoints / stride);
			const result = new Float32Array(outputPointCount * 2);

			for (let oi = 0; oi < outputPointCount; oi++) {
				const windowStart = oi * stride;
				const windowEnd = Math.min(windowStart + stride, totalPoints);

				let windowMin = 1;
				let windowMax = -1;

				for (let pi = windowStart; pi < windowEnd; pi++) {
					const offset = pi * pointSize + channelOffset;
					const pointMin = view.getFloat32(offset, true);
					const pointMax = view.getFloat32(offset + 4, true);
					if (pointMin < windowMin) windowMin = pointMin;
					if (pointMax > windowMax) windowMax = pointMax;
				}

				result[oi * 2] = windowMin;
				result[oi * 2 + 1] = windowMax;
			}

			return result;
		} finally {
			await handle.close();
		}
	}
}
