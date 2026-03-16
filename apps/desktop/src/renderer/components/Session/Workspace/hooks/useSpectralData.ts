import { useEffect, useRef, useState } from "react";
import type { SpectrogramHeader } from "./useSpectrogramHeader";
import type { WaveformHeader } from "./useWaveformHeader";
import { timeToPoint } from "./useWaveformHeader";

export interface SpectralSlice {
	readonly data: Float32Array;
	readonly width: number;
	readonly startIndex: number;
	readonly endIndex: number;
}

export interface ChannelSpectralData {
	readonly spectrogramOverview: SpectralSlice | null;
	readonly spectrogramDetail: SpectralSlice | null;
	readonly waveformOverview: SpectralSlice | null;
	readonly waveformDetail: SpectralSlice | null;
}

export type SpectralData = ReadonlyArray<ChannelSpectralData>;

function emptyChannel(): ChannelSpectralData {
	return { spectrogramOverview: null, spectrogramDetail: null, waveformOverview: null, waveformDetail: null };
}

function isViewportCovered(detail: SpectralSlice | null, visibleStart: number, visibleEnd: number): boolean {
	if (!detail) return false;
	return detail.startIndex <= visibleStart && detail.endIndex >= visibleEnd;
}

function expandRange(start: number, end: number, max: number): { start: number; end: number } {
	const range = end - start;
	const padding = Math.floor(range * 0.25);
	return {
		start: Math.max(0, start - padding),
		end: Math.min(max, end + padding),
	};
}

function computeVisibleFrameRange(
	scrollX: number,
	viewportWidth: number,
	pixelsPerSecond: number,
	header: SpectrogramHeader,
): { startFrame: number; endFrame: number } {
	const startMs = (scrollX / pixelsPerSecond) * 1000;
	const endMs = ((scrollX + viewportWidth) / pixelsPerSecond) * 1000;

	const startFrame = Math.max(0, Math.floor(((startMs / 1000) * header.sampleRate) / header.hopSize));
	const endFrame = Math.min(header.numFrames, Math.ceil(((endMs / 1000) * header.sampleRate) / header.hopSize));

	return { startFrame, endFrame };
}

function computeVisiblePointRange(
	scrollX: number,
	viewportWidth: number,
	pixelsPerSecond: number,
	header: WaveformHeader,
): { startPoint: number; endPoint: number } {
	const startMs = (scrollX / pixelsPerSecond) * 1000;
	const endMs = ((scrollX + viewportWidth) / pixelsPerSecond) * 1000;

	const startPoint = Math.max(0, timeToPoint(startMs, header.resolution));
	const endPoint = Math.min(header.totalPoints, Math.ceil((endMs / 1000) * header.resolution));

	return { startPoint, endPoint };
}

async function loadSpectrogramSlice(
	path: string,
	channel: number,
	header: SpectrogramHeader,
	startFrame: number,
	endFrame: number,
	stride: number,
): Promise<SpectralSlice> {
	const data = await window.main.readSpectrogramRange(path, channel, startFrame, endFrame, stride, header.numBins, header.channels);

	return {
		data,
		width: Math.ceil((endFrame - startFrame) / stride),
		startIndex: startFrame,
		endIndex: endFrame,
	};
}

async function loadWaveformSlice(
	path: string,
	channel: number,
	header: WaveformHeader,
	startPoint: number,
	endPoint: number,
	stride: number,
): Promise<SpectralSlice> {
	const data = await window.main.readWaveformRange(path, channel, startPoint, endPoint, stride, header.channels);

	return {
		data,
		width: Math.ceil((endPoint - startPoint) / stride),
		startIndex: startPoint,
		endIndex: endPoint,
	};
}

const EMPTY: SpectralData = [];

export function useSpectralData(
	snapshotPath: string,
	spectrogramHeader: SpectrogramHeader | undefined,
	waveformHeader: WaveformHeader | undefined,
	scrollX: number,
	pixelsPerSecond: number,
	viewportWidth: number,
): SpectralData {
	const [data, setData] = useState<SpectralData>(EMPTY);
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

	useEffect(() => {
		if (!spectrogramHeader || !waveformHeader || channels === 0 || viewportWidth <= 0) return;
		if (data.length !== channels) return;

		const specRange = computeVisibleFrameRange(scrollX, viewportWidth, pixelsPerSecond, spectrogramHeader);
		const waveRange = computeVisiblePointRange(scrollX, viewportWidth, pixelsPerSecond, waveformHeader);

		let needsSpecDetail = false;
		let needsWaveDetail = false;

		for (let ch = 0; ch < channels; ch++) {
			const channel = data[ch];
			if (!channel) continue;
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

				const existing = data[ch] ?? emptyChannel();
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
				setData(updated);
			}
		};

		void load();
	}, [snapshotPath, spectrogramHeader, waveformHeader, channels, data, scrollX, pixelsPerSecond, viewportWidth]);

	return data;
}
