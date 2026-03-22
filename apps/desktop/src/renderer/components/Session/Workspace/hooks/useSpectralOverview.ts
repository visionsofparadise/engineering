import { useEffect, useRef, useState } from "react";
import type { SpectrogramHeader } from "./useSpectrogramHeader";
import type { WaveformHeader } from "./useWaveformHeader";
import type { ChannelSpectralData } from "./useSpectralData";
import { loadSpectrogramSlice, loadWaveformSlice } from "./useSpectralData";

export type OverviewData = ReadonlyArray<ChannelSpectralData>;

const EMPTY: OverviewData = [];

export function useSpectralOverview(
	snapshotPath: string,
	spectrogramHeader: SpectrogramHeader | undefined,
	waveformHeader: WaveformHeader | undefined,
	viewportWidth: number,
): OverviewData {
	const [data, setData] = useState<OverviewData>(EMPTY);
	const generationRef = useRef(0);

	const channels = spectrogramHeader?.channels ?? waveformHeader?.channels ?? 0;

	useEffect(() => {
		if (!spectrogramHeader || !waveformHeader || channels === 0 || viewportWidth <= 0) return;

		const generation = ++generationRef.current;

		const load = async () => {
			const specPath = `${snapshotPath}/spectrogram.bin`;
			const wavePath = `${snapshotPath}/waveform.bin`;
			const overviewDensity = 4;
			const specStride = Math.max(1, Math.floor(spectrogramHeader.numFrames / (viewportWidth * overviewDensity)));
			const waveStride = Math.max(1, Math.floor(waveformHeader.totalPoints / (viewportWidth * overviewDensity)));

			const result: Array<ChannelSpectralData> = [];

			for (let ch = 0; ch < channels; ch++) {
				if (generationRef.current !== generation) return;

				const spectrogramOverview = await loadSpectrogramSlice(specPath, ch, spectrogramHeader, 0, spectrogramHeader.numFrames, specStride);

				if (generationRef.current !== generation) return;

				const waveformOverview = await loadWaveformSlice(wavePath, ch, waveformHeader, 0, waveformHeader.totalPoints, waveStride);

				if (generationRef.current !== generation) return;

				result.push({ spectrogramOverview, spectrogramDetail: null, waveformOverview, waveformDetail: null });
			}

			if (generationRef.current === generation) {
				setData(result);
			}
		};

		void load();
	}, [snapshotPath, spectrogramHeader, waveformHeader, channels, viewportWidth]);

	return data;
}
