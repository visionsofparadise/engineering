import { useQuery } from "@tanstack/react-query";

export type FrequencyScale = "linear" | "log" | "mel" | "erb";

const FREQUENCY_SCALE_FROM_BYTE: Record<number, FrequencyScale> = { 0: "linear", 1: "log", 2: "mel", 3: "erb" };

export interface SpectrogramHeader {
	readonly sampleRate: number;
	readonly channels: number;
	readonly fftSize: number;
	readonly hopSize: number;
	readonly numFrames: number;
	readonly numBins: number;
	readonly frequencyScale: FrequencyScale;
	readonly minFrequency: number;
	readonly maxFrequency: number;
}

export const SPECTROGRAM_HEADER_SIZE = 33;

async function loadSpectrogramHeader(filePath: string): Promise<SpectrogramHeader> {
	const data = await window.main.readFileChunk(filePath, 0, SPECTROGRAM_HEADER_SIZE);
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

	return {
		sampleRate: view.getUint32(0, true),
		channels: view.getUint32(4, true),
		fftSize: view.getUint32(8, true),
		hopSize: view.getUint32(12, true),
		numFrames: view.getUint32(16, true),
		numBins: view.getUint32(20, true),
		frequencyScale: FREQUENCY_SCALE_FROM_BYTE[view.getUint8(24)] ?? "log",
		minFrequency: view.getFloat32(25, true),
		maxFrequency: view.getFloat32(29, true),
	};
}

export function frameToMs(frame: number, hopSize: number, sampleRate: number): number {
	return ((frame * hopSize) / sampleRate) * 1000;
}

export function msToFrame(ms: number, hopSize: number, sampleRate: number): number {
	return Math.floor(((ms / 1000) * sampleRate) / hopSize);
}

export function useSpectrogramHeader(snapshotPath: string): SpectrogramHeader | undefined {
	const query = useQuery({
		queryKey: ["spectrogramHeader", snapshotPath],
		queryFn: () => loadSpectrogramHeader(`${snapshotPath}/spectrogram.bin`),
		enabled: !!snapshotPath,
	});

	return query.data;
}
