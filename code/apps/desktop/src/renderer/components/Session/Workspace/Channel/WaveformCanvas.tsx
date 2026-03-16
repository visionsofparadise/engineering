import { useEffect, useRef } from "react";
import type { WorkspaceContext } from "../../../../models/Context";
import type { SpectralTheme } from "../../../../models/State/App";
import { msToPixels } from "../../../../utils/time";
import type { SpectralSlice } from "../hooks/useSpectralData";

interface WaveformCanvasProps {
	readonly channelIndex: number;
	readonly context: WorkspaceContext;
}

const WAVEFORM_COLORS: Record<SpectralTheme, string> = {
	lava: "rgb(40, 135, 180)",
	viridis: "rgb(180, 115, 42)",
};

const SAMPLE_MARKER_THRESHOLD = 4;

function drawSlice(
	canvasContext: CanvasRenderingContext2D,
	slice: SpectralSlice,
	canvasWidth: number,
	canvasHeight: number,
	scrollX: number,
	pixelsPerSecond: number,
	resolution: number,
	color: string,
	pixelsPerSample: number,
): void {
	const sliceStartMs = (slice.startIndex / resolution) * 1000;
	const sliceEndMs = (slice.endIndex / resolution) * 1000;
	const sliceStartPx = msToPixels(sliceStartMs, pixelsPerSecond) - scrollX;
	const sliceEndPx = msToPixels(sliceEndMs, pixelsPerSecond) - scrollX;

	const drawX = Math.max(0, Math.floor(sliceStartPx));
	const drawEnd = Math.min(canvasWidth, Math.ceil(sliceEndPx));
	const drawW = drawEnd - drawX;

	if (drawW <= 0) return;

	const sliceWidthPx = sliceEndPx - sliceStartPx;
	const srcStartFrac = (drawX - sliceStartPx) / sliceWidthPx;
	const srcEndFrac = (drawEnd - sliceStartPx) / sliceWidthPx;
	const points = slice.data.length / 2;
	const srcStart = Math.floor(srcStartFrac * points);
	const srcEnd = Math.min(points, Math.ceil(srcEndFrac * points));
	const srcCount = srcEnd - srcStart;

	if (srcCount <= 0) return;

	const centerY = canvasHeight / 2;
	const pointsPerPixel = srcCount / drawW;

	canvasContext.strokeStyle = color;
	canvasContext.lineWidth = 1;
	canvasContext.beginPath();

	if (pointsPerPixel > 1) {
		for (let px = 0; px < drawW; px++) {
			const pStart = srcStart + Math.floor(px * pointsPerPixel);
			const pEnd = srcStart + Math.min(srcCount, Math.floor((px + 1) * pointsPerPixel));

			let pxMin = 1;
			let pxMax = -1;

			for (let pi = pStart; pi < pEnd; pi++) {
				const mn = slice.data[pi * 2] ?? 0;
				const mx = slice.data[pi * 2 + 1] ?? 0;
				if (mn < pxMin) pxMin = mn;
				if (mx > pxMax) pxMax = mx;
			}

			const x = drawX + px;
			canvasContext.moveTo(x, centerY - pxMin * centerY);
			canvasContext.lineTo(x, centerY - pxMax * centerY);
		}
	} else {
		const pixelsPerPoint = drawW / srcCount;

		for (let index = 0; index < srcCount; index++) {
			const dataIndex = srcStart + index;
			const min = slice.data[dataIndex * 2] ?? 0;
			const max = slice.data[dataIndex * 2 + 1] ?? 0;
			const x = drawX + index * pixelsPerPoint;
			canvasContext.moveTo(x, centerY - min * centerY);
			canvasContext.lineTo(x, centerY - max * centerY);
		}
	}

	canvasContext.stroke();

	if (pixelsPerSample >= SAMPLE_MARKER_THRESHOLD && pointsPerPixel <= 1) {
		const pixelsPerPoint = drawW / srcCount;
		canvasContext.fillStyle = color;
		const radius = Math.min(3, pixelsPerSample / 3);

		for (let index = 0; index < srcCount; index++) {
			const dataIndex = srcStart + index;
			const min = slice.data[dataIndex * 2] ?? 0;
			const max = slice.data[dataIndex * 2 + 1] ?? 0;
			const x = drawX + index * pixelsPerPoint;
			const midY = centerY - ((min + max) / 2) * centerY;

			canvasContext.beginPath();
			canvasContext.arc(x, midY, radius, 0, Math.PI * 2);
			canvasContext.fill();
		}
	}
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({ channelIndex, context }) => {
	const { app, workspace, waveformHeader, channelCount, spectralData } = context;
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const viewportWidth = workspace.viewportWidth.value;
	const viewportHeight = workspace.viewportHeight.value;
	const height = viewportHeight > 0 ? viewportHeight / channelCount : 0;
	const width = viewportWidth;
	const scrollX = workspace.scrollX.value;
	const pixelsPerSecond = workspace.pixelsPerSecond.value;
	const spectralTheme = app.spectralTheme;
	const sampleRate = waveformHeader.sampleRate;
	const resolution = waveformHeader.resolution;
	const channelData = spectralData[channelIndex];
	const overview = channelData?.waveformOverview ?? null;
	const detail = channelData?.waveformDetail ?? null;

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || width <= 0 || height <= 0) return;

		canvas.width = width;
		canvas.height = height;

		const canvasContext = canvas.getContext("2d");
		if (!canvasContext) return;
		canvasContext.clearRect(0, 0, width, height);

		const color = WAVEFORM_COLORS[spectralTheme];
		const pixelsPerSample = pixelsPerSecond / sampleRate;

		if (overview) {
			drawSlice(canvasContext, overview, width, height, scrollX, pixelsPerSecond, resolution, color, pixelsPerSample);
		}

		if (detail) {
			drawSlice(canvasContext, detail, width, height, scrollX, pixelsPerSecond, resolution, color, pixelsPerSample);
		}
	}, [overview, detail, width, height, spectralTheme, scrollX, pixelsPerSecond, sampleRate, resolution]);

	return (
		<canvas
			ref={canvasRef}
			className="absolute inset-0 block"
			style={{ width, height }}
		/>
	);
};
