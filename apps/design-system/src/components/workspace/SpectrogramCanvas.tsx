import { useEffect, useRef } from "react";
import { viridisColor } from "./utils/viridis";

export type ColormapFn = (normalized: number) => readonly [number, number, number];

interface SpectrogramCanvasProps {
	readonly data: Float32Array;
	readonly numFrames: number;
	readonly numBins: number;
	readonly width: number;
	readonly height: number;
	readonly dbRange: readonly [number, number];
	readonly colormap?: ColormapFn;
}

export function SpectrogramCanvas({ data, numFrames, numBins, width, height, dbRange, colormap = viridisColor }: SpectrogramCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const canvasContext = canvas.getContext("2d");
		if (!canvasContext) return;

		canvas.width = width;
		canvas.height = height;

		if (numFrames === 0 || numBins === 0) {
			canvasContext.clearRect(0, 0, width, height);
			return;
		}

		const imageData = canvasContext.createImageData(width, height);
		const pixels = imageData.data;
		const dbMin = dbRange[0];
		const dbMax = dbRange[1];
		const dbSpan = dbMax - dbMin;

		for (let py = 0; py < height; py++) {
			const band = Math.floor(((height - 1 - py) / (height - 1)) * (numBins - 1));

			for (let px = 0; px < width; px++) {
				const frame = Math.floor((px / width) * numFrames);
				const magnitude = data[frame * numBins + band] ?? 0;

				const db = magnitude > 0 ? 20 * Math.log10(magnitude) : dbMin;
				const normalized = Math.max(0, Math.min(1, (db - dbMin) / dbSpan));

				const [red, green, blue] = colormap(normalized);
				const offset = (py * width + px) * 4;
				pixels[offset] = red;
				pixels[offset + 1] = green;
				pixels[offset + 2] = blue;
				pixels[offset + 3] = 255;
			}
		}

		canvasContext.putImageData(imageData, 0, 0);
	}, [data, numFrames, numBins, width, height, dbRange, colormap]);

	return (
		<canvas
			ref={canvasRef}
			className="block"
			style={{ width, height }}
		/>
	);
}
