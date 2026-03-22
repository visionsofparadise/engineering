import { useQuery } from "@tanstack/react-query";

export interface WaveformHeader {
	readonly sampleRate: number;
	readonly channels: number;
	readonly resolution: number;
	readonly totalPoints: number;
}

export const WAVEFORM_HEADER_SIZE = 16;

async function loadWaveformHeader(filePath: string): Promise<WaveformHeader> {
	const data = await window.main.readFileChunk(filePath, 0, WAVEFORM_HEADER_SIZE);
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

	return {
		sampleRate: view.getUint32(0, true),
		channels: view.getUint32(4, true),
		resolution: view.getUint32(8, true),
		totalPoints: view.getUint32(12, true),
	};
}

export function timeToPoint(ms: number, resolution: number): number {
	return Math.floor((ms / 1000) * resolution);
}

export function pointToTime(point: number, resolution: number): number {
	return (point / resolution) * 1000;
}

export function useWaveformHeader(snapshotPath: string): WaveformHeader | undefined {
	const query = useQuery({
		queryKey: ["waveformHeader", snapshotPath],
		queryFn: () => loadWaveformHeader(`${snapshotPath}/waveform.bin`),
		enabled: !!snapshotPath,
	});

	return query.data;
}
