const MIN_PIXELS_PER_SECOND = 0.01;
const MAX_PIXELS_PER_SECOND = 262144;

export function msToPixels(ms: number, pixelsPerSecond: number): number {
	return (ms * pixelsPerSecond) / 1000;
}

export function pixelsToMs(pixels: number, pixelsPerSecond: number): number {
	return (pixels * 1000) / pixelsPerSecond;
}

export function formatTime(ms: number): string {
	const totalSeconds = Math.abs(ms) / 1000;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const milliseconds = Math.floor((totalSeconds % 1) * 1000);

	if (hours > 0) {
		return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
	}

	return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}

export function getMinPixelsPerSecond(viewportWidth: number, durationMs: number): number {
	if (durationMs <= 0 || viewportWidth <= 0) return MIN_PIXELS_PER_SECOND;
	return (viewportWidth * 1000) / durationMs;
}

export function clampPixelsPerSecond(pps: number, viewportWidth: number, durationMs: number): number {
	const minPps = getMinPixelsPerSecond(viewportWidth, durationMs);
	return Math.max(minPps, Math.min(MAX_PIXELS_PER_SECOND, pps));
}

export function msToSampleFrame(ms: number, sampleRate: number): number {
	return Math.round((ms / 1000) * sampleRate);
}

export function sampleFrameToMs(frame: number, sampleRate: number): number {
	return (frame / sampleRate) * 1000;
}
