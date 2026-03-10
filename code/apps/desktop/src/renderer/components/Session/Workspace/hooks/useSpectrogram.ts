import { useQuery } from "@tanstack/react-query";
import { SPECTROGRAM_HEADER_SIZE, type SpectrogramHeader, useSpectrogramHeader } from "./useSpectrogramHeader";

async function loadSpectrogramData(filePath: string, header: SpectrogramHeader): Promise<Array<Float32Array>> {
	const bytesPerFrame = header.channels * header.numBins * 4;
	const length = header.numFrames * bytesPerFrame;

	const data = await window.main.readFileChunk(filePath, SPECTROGRAM_HEADER_SIZE, length);
	const floats = new Float32Array(data.buffer, data.byteOffset, data.length / 4);

	const channels: Array<Float32Array> = [];

	for (let ch = 0; ch < header.channels; ch++) {
		channels.push(new Float32Array(header.numFrames * header.numBins));
	}

	const binsPerFrame = header.numBins * header.channels;

	for (let frame = 0; frame < header.numFrames; frame++) {
		for (let ch = 0; ch < header.channels; ch++) {
			const channel = channels[ch];

			if (!channel) continue;

			const srcOffset = frame * binsPerFrame + ch * header.numBins;
			const dstOffset = frame * header.numBins;

			for (let bin = 0; bin < header.numBins; bin++) {
				channel[dstOffset + bin] = floats[srcOffset + bin] ?? 0;
			}
		}
	}

	return channels;
}

export function useSpectrogram(snapshotPath: string): Array<Float32Array> | undefined {
	const header = useSpectrogramHeader(snapshotPath);
	const spectrogramPath = `${snapshotPath}/spectrogram.bin`;

	const query = useQuery({
		queryKey: ["spectrogramData", spectrogramPath],
		queryFn: () => {
			if (!header) return [];

			return loadSpectrogramData(spectrogramPath, header);
		},
		enabled: !!header,
	});

	return query.data;
}
