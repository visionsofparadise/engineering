import { useEffect, useRef } from "react";

interface WaveformCanvasProps {
	readonly data: Float32Array;
	readonly width: number;
	readonly height: number;
	readonly color: string;
	readonly opacity: number;
}

export function WaveformCanvas({ data, width, height, color, opacity }: WaveformCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const canvasContext = canvas.getContext("2d");
		if (!canvasContext) return;

		canvas.width = width;
		canvas.height = height;
		canvasContext.clearRect(0, 0, width, height);

		const points = data.length / 2;
		if (points === 0) return;

		canvasContext.strokeStyle = color;
		canvasContext.lineWidth = 1;
		canvasContext.globalAlpha = opacity;

		const centerY = height / 2;

		if (points <= width) {
			const pixelsPerPoint = width / points;

			canvasContext.beginPath();
			for (let point = 0; point < points; point++) {
				const min = data[point * 2] ?? 0;
				const max = data[point * 2 + 1] ?? 0;
				const pointX = point * pixelsPerPoint;
				const minY = centerY - min * centerY;
				const maxY = centerY - max * centerY;
				canvasContext.moveTo(pointX, minY);
				canvasContext.lineTo(pointX, maxY);
			}
			canvasContext.stroke();
		} else {
			const pointsPerPixel = points / width;

			canvasContext.beginPath();
			for (let px = 0; px < width; px++) {
				const startPoint = Math.floor(px * pointsPerPixel);
				const endPoint = Math.min(Math.floor((px + 1) * pointsPerPixel), points);

				let pixelMin = 1;
				let pixelMax = -1;

				for (let point = startPoint; point < endPoint; point++) {
					const min = data[point * 2] ?? 0;
					const max = data[point * 2 + 1] ?? 0;
					if (min < pixelMin) pixelMin = min;
					if (max > pixelMax) pixelMax = max;
				}

				const minY = centerY - pixelMin * centerY;
				const maxY = centerY - pixelMax * centerY;
				canvasContext.moveTo(px, minY);
				canvasContext.lineTo(px, maxY);
			}
			canvasContext.stroke();
		}
	}, [data, width, height, color, opacity]);

	return (
		<canvas
			ref={canvasRef}
			className="block"
			style={{ width, height }}
		/>
	);
}
