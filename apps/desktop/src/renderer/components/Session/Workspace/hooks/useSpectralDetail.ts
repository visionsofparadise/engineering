import { useEffect, useRef, useState } from "react";
import type { SpectrogramHeader } from "./useSpectrogramHeader";
import type { WaveformHeader } from "./useWaveformHeader";
import type { ChannelSpectralData, SpectralData } from "./useSpectralData";
import {
	computeVisibleFrameRange,
	computeVisiblePointRange,
	emptyChannel,
	expandRange,
	isViewportCovered,
	loadSpectrogramSlice,
	loadWaveformSlice,
} from "./useSpectralData";

export type DetailData = ReadonlyArray<ChannelSpectralData>;

const EMPTY: DetailData = [];

export function useSpectralDetail(
	snapshotPath: string,
	spectrogramHeader: SpectrogramHeader | undefined,
	waveformHeader: WaveformHeader | undefined,
	scrollX: number,
	pixelsPerSecond: number,
	viewportWidth: number,
	overviewData: SpectralData,
): DetailData {
	const [data, setData] = useState<DetailData>(EMPTY);
	const generationRef = useRef(0);
	const dataRef = useRef<DetailData>(EMPTY);

	const channels = spectrogramHeader?.channels ?? waveformHeader?.channels ?? 0;

	useEffect(() => {
		if (!spectrogramHeader || !waveformHeader || channels === 0 || viewportWidth <= 0) return;

		// Use the ref for coverage checks to avoid depending on data state
		const currentData = dataRef.current;
		if (currentData.length !== channels && overviewData.length !== channels) return;

		const specRange = computeVisibleFrameRange(scrollX, viewportWidth, pixelsPerSecond, spectrogramHeader);
		const waveRange = computeVisiblePointRange(scrollX, viewportWidth, pixelsPerSecond, waveformHeader);

		let needsSpecDetail = false;
		let needsWaveDetail = false;

		for (let ch = 0; ch < channels; ch++) {
			const channel = currentData[ch];
			if (!channel) {
				needsSpecDetail = true;
				needsWaveDetail = true;
				break;
			}
			if (!isViewportCovered(channel.spectrogramDetail, specRange.startFrame, specRange.endFrame)) needsSpecDetail = true;
			if (!isViewportCovered(channel.waveformDetail, waveRange.startPoint, waveRange.endPoint)) needsWaveDetail = true;
		}

		if (!needsSpecDetail && !needsWaveDetail) return;

		const generation = ++generationRef.current;

		const load = async () => {
			const specPath = `${snapshotPath}/spectrogram.bin`;
			const wavePath = `${snapshotPath}/waveform.bin`;
			const specExpanded = expandRange(specRange.startFrame, specRange.endFrame, spectrogramHeader.numFrames);
			const waveExpanded = expandRange(waveRange.startPoint, waveRange.endPoint, waveformHeader.totalPoints);

			const updated: Array<ChannelSpectralData> = [];

			for (let ch = 0; ch < channels; ch++) {
				if (generationRef.current !== generation) return;

				const existing = currentData[ch] ?? emptyChannel();
				let spectrogramDetail = existing.spectrogramDetail;
				let waveformDetail = existing.waveformDetail;

				if (needsSpecDetail) {
					spectrogramDetail = await loadSpectrogramSlice(specPath, ch, spectrogramHeader, specExpanded.start, specExpanded.end, 1);
					if (generationRef.current !== generation) return;
				}

				if (needsWaveDetail) {
					waveformDetail = await loadWaveformSlice(wavePath, ch, waveformHeader, waveExpanded.start, waveExpanded.end, 1);
					if (generationRef.current !== generation) return;
				}

				updated.push({
					spectrogramOverview: existing.spectrogramOverview,
					spectrogramDetail,
					waveformOverview: existing.waveformOverview,
					waveformDetail,
				});
			}

			if (generationRef.current === generation) {
				dataRef.current = updated;
				setData(updated);
			}
		};

		void load();
	}, [snapshotPath, spectrogramHeader, waveformHeader, channels, scrollX, pixelsPerSecond, viewportWidth, overviewData]);

	return data;
}
