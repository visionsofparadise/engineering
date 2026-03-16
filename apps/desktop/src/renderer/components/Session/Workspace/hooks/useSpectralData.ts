import { useEffect, useMemo, useState } from "react";
import type { SpectrogramHeader } from "./useSpectrogramHeader";
import type { WaveformHeader } from "./useWaveformHeader";
import { timeToPoint } from "./useWaveformHeader";
import { useSpectralOverview } from "./useSpectralOverview";
import { useSpectralDetail } from "./useSpectralDetail";

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

// --- Shared helpers (used by useSpectralOverview and useSpectralDetail) ---

export function emptyChannel(): ChannelSpectralData {
	return { spectrogramOverview: null, spectrogramDetail: null, waveformOverview: null, waveformDetail: null };
}

export function isViewportCovered(detail: SpectralSlice | null, visibleStart: number, visibleEnd: number): boolean {
	if (!detail) return false;
	return detail.startIndex <= visibleStart && detail.endIndex >= visibleEnd;
}

export function expandRange(start: number, end: number, max: number): { start: number; end: number } {
	const range = end - start;
	const padding = Math.floor(range * 0.25);
	return {
		start: Math.max(0, start - padding),
		end: Math.min(max, end + padding),
	};
}

export function computeVisibleFrameRange(
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

export function computeVisiblePointRange(
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

export async function loadSpectrogramSlice(
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

export async function loadWaveformSlice(
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

// --- Debounce utility ---

function useDebounce<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState(value);
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(timer);
	}, [value, delayMs]);
	return debounced;
}

// --- Coordinator hook ---

const EMPTY: SpectralData = [];

export function useSpectralData(
	snapshotPath: string,
	spectrogramHeader: SpectrogramHeader | undefined,
	waveformHeader: WaveformHeader | undefined,
	scrollX: number,
	pixelsPerSecond: number,
	viewportWidth: number,
): SpectralData {
	const debouncedViewportWidth = useDebounce(viewportWidth, 150);

	const overviewData = useSpectralOverview(snapshotPath, spectrogramHeader, waveformHeader, debouncedViewportWidth);

	const detailData = useSpectralDetail(snapshotPath, spectrogramHeader, waveformHeader, scrollX, pixelsPerSecond, viewportWidth, overviewData);

	const channels = spectrogramHeader?.channels ?? waveformHeader?.channels ?? 0;

	return useMemo(() => {
		if (channels === 0) return EMPTY;

		// If neither hook has loaded yet, return empty
		if (overviewData.length === 0 && detailData.length === 0) return EMPTY;

		const result: Array<ChannelSpectralData> = [];

		for (let ch = 0; ch < channels; ch++) {
			const overview = overviewData[ch];
			const detail = detailData[ch];

			result.push({
				spectrogramOverview: overview?.spectrogramOverview ?? null,
				spectrogramDetail: detail?.spectrogramDetail ?? null,
				waveformOverview: overview?.waveformOverview ?? null,
				waveformDetail: detail?.waveformDetail ?? null,
			});
		}

		return result;
	}, [channels, overviewData, detailData]);
}
