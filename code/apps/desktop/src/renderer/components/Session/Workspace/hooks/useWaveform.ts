import { useQuery } from "@tanstack/react-query";
import { WAVEFORM_HEADER_SIZE, type WaveformHeader, useWaveformHeader } from "./useWaveformHeader";

async function loadWaveformData(filePath: string, header: WaveformHeader): Promise<Array<Float32Array>> {
	const bytesPerPoint = header.channels * 2 * 4;
	const length = header.totalPoints * bytesPerPoint;

	const data = await window.main.readFileChunk(filePath, WAVEFORM_HEADER_SIZE, length);
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

	const channels: Array<Float32Array> = [];

	for (let ch = 0; ch < header.channels; ch++) {
		channels.push(new Float32Array(header.totalPoints * 2));
	}

	for (let point = 0; point < header.totalPoints; point++) {
		for (let ch = 0; ch < header.channels; ch++) {
			const baseOffset = (point * header.channels + ch) * 8;
			const channel = channels[ch];

			if (channel) {
				channel[point * 2] = view.getFloat32(baseOffset, true);
				channel[point * 2 + 1] = view.getFloat32(baseOffset + 4, true);
			}
		}
	}

	return channels;
}

export function useWaveform(snapshotPath: string): Array<Float32Array> | undefined {
	const header = useWaveformHeader(snapshotPath);
	const waveformPath = `${snapshotPath}/waveform.bin`;

	const query = useQuery({
		queryKey: ["waveformData", waveformPath],
		queryFn: () => {
			if (!header) return [];

			return loadWaveformData(waveformPath, header);
		},
		enabled: !!header,
	});

	return query.data;
}
