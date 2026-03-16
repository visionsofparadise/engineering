import { useEffect, useRef } from "react";
import type { WorkspaceContext } from "../../../../models/Context";
import type { SpectralTheme } from "../../../../models/State/App";
import { msToPixels } from "../../../../utils/time";
import type { SpectralSlice } from "../hooks/useSpectralData";
import { lavaColor } from "./utils/lava";
import { viridisColor } from "./utils/viridis";
import { SpectrogramRenderer, generateColormapTexture } from "./utils/webgl";

interface SpectrogramCanvasProps {
	readonly channelIndex: number;
	readonly context: WorkspaceContext;
}

const COLORMAP_TEXTURES: Record<SpectralTheme, Uint8Array> = {
	lava: generateColormapTexture(lavaColor),
	viridis: generateColormapTexture(viridisColor),
};

const DB_RANGE: readonly [number, number] = [-120, 0];

function renderSlice(
	renderer: SpectrogramRenderer,
	slice: SpectralSlice,
	numBins: number,
	canvas: HTMLCanvasElement,
	canvasWidth: number,
	canvasHeight: number,
	scrollX: number,
	pixelsPerSecond: number,
	hopSize: number,
	sampleRate: number,
): void {
	const sliceStartMs = ((slice.startIndex * hopSize) / sampleRate) * 1000;
	const sliceEndMs = ((slice.endIndex * hopSize) / sampleRate) * 1000;
	const sliceStartPx = msToPixels(sliceStartMs, pixelsPerSecond) - scrollX;
	const sliceEndPx = msToPixels(sliceEndMs, pixelsPerSecond) - scrollX;

	const drawX = Math.max(0, Math.floor(sliceStartPx));
	const drawEnd = Math.min(canvasWidth, Math.ceil(sliceEndPx));
	const drawW = drawEnd - drawX;

	if (drawW <= 0) return;

	const sliceWidthPx = sliceEndPx - sliceStartPx;
	const srcStartFrac = (drawX - sliceStartPx) / sliceWidthPx;
	const srcEndFrac = (drawEnd - sliceStartPx) / sliceWidthPx;
	const srcStartFrame = Math.floor(srcStartFrac * slice.width);
	const srcEndFrame = Math.min(slice.width, Math.ceil(srcEndFrac * slice.width));
	const srcFrameCount = srcEndFrame - srcStartFrame;

	if (srcFrameCount <= 0) return;

	const srcData = slice.data.subarray(srcStartFrame * numBins, srcEndFrame * numBins);
	renderer.render(srcData, srcFrameCount, numBins, DB_RANGE, canvas, drawX, drawW, canvasHeight);
}

export const SpectrogramCanvas: React.FC<SpectrogramCanvasProps> = ({ channelIndex, context }) => {
	const { app, workspace, spectrogramHeader, channelCount, spectralData } = context;

	const canvasRef = useRef<HTMLCanvasElement>(null);
	const rendererRef = useRef<SpectrogramRenderer | null>(null);
	const lastThemeRef = useRef<SpectralTheme | null>(null);

	const viewportWidth = workspace.viewportWidth.value;
	const viewportHeight = workspace.viewportHeight.value;
	const height = viewportHeight > 0 ? viewportHeight / channelCount : 0;
	const width = viewportWidth;
	const scrollX = workspace.scrollX.value;
	const pixelsPerSecond = workspace.pixelsPerSecond.value;
	const numBins = spectrogramHeader.numBins;
	const hopSize = spectrogramHeader.hopSize;
	const sampleRate = spectrogramHeader.sampleRate;
	const spectralTheme = app.spectralTheme;
	const channelData = spectralData[channelIndex];
	const overview = channelData?.spectrogramOverview ?? null;
	const detail = channelData?.spectrogramDetail ?? null;

	useEffect(() => {
		rendererRef.current = new SpectrogramRenderer();
		lastThemeRef.current = null;
		return () => {
			rendererRef.current?.dispose();
			rendererRef.current = null;
		};
	}, []);

	useEffect(() => {
		const canvas = canvasRef.current;
		const renderer = rendererRef.current;
		if (!canvas || !renderer || width <= 0 || height <= 0) return;

		canvas.width = width;
		canvas.height = height;

		const canvasContext = canvas.getContext("2d");
		if (!canvasContext) return;
		canvasContext.clearRect(0, 0, width, height);

		if (lastThemeRef.current !== spectralTheme) {
			renderer.uploadColormap(COLORMAP_TEXTURES[spectralTheme]);
			lastThemeRef.current = spectralTheme;
		}

		if (overview) {
			renderSlice(renderer, overview, numBins, canvas, width, height, scrollX, pixelsPerSecond, hopSize, sampleRate);
		}

		if (detail) {
			renderSlice(renderer, detail, numBins, canvas, width, height, scrollX, pixelsPerSecond, hopSize, sampleRate);
		}
	}, [overview, detail, numBins, width, height, spectralTheme, scrollX, pixelsPerSecond, hopSize, sampleRate]);

	return (
		<canvas
			ref={canvasRef}
			className="absolute inset-0 block"
			style={{ width, height }}
		/>
	);
};
