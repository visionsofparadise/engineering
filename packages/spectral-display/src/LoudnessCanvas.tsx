import { useEffect, useRef } from "react";
import type { LoudnessData } from "./engine/loudness";
import type { Dimensions } from "./engine/SpectralEngine";
import type { ComputeResult } from "./useSpectralCompute";

export interface LoudnessCanvasProps {
	computeResult: ComputeResult;
	rmsEnvelope?: boolean;
	momentary?: boolean;
	shortTerm?: boolean;
	integrated?: boolean;
	truePeak?: boolean;
	colors?: {
		rms?: string;
		momentary?: string;
		shortTerm?: string;
		integrated?: string;
		truePeak?: string;
	};
}

const DEFAULT_COLORS: Required<NonNullable<LoudnessCanvasProps["colors"]>> = {
	rms: "rgba(0, 200, 255, 0.6)",
	momentary: "rgba(255, 200, 0, 0.8)",
	shortTerm: "rgba(0, 255, 100, 0.8)",
	integrated: "rgba(255, 255, 255, 0.9)",
	truePeak: "rgba(255, 80, 80, 0.9)",
};

function lufsToY(lufs: number, canvasHeight: number): number {
	if (!isFinite(lufs) || lufs < -60) return canvasHeight / 2;

	const amplitude = Math.pow(10, lufs / 20);

	return canvasHeight / 2 - amplitude * (canvasHeight / 2);
}

function drawRmsEnvelope(loudness: LoudnessData, color: string, dimensions: Dimensions, context: CanvasRenderingContext2D): void {
	const { rmsEnvelope, pointCount } = loudness;
	const { width, height } = dimensions;

	if (pointCount === 0) return;

	const centerY = height / 2;
	const halfHeight = height / 2;
	const stride = (pointCount - 1) / width;

	context.beginPath();
	context.moveTo(0, centerY);

	for (let px = 0; px < width; px++) {
		const ptStart = Math.floor(px * stride);
		const ptEnd = Math.min(Math.floor((px + 1) * stride), pointCount - 1);

		let maxRms = 0;

		for (let pt = ptStart; pt <= ptEnd; pt++) {
			const rms = rmsEnvelope[pt]!;

			if (rms > maxRms) maxRms = rms;
		}

		context.lineTo(px, centerY - maxRms * halfHeight);
	}

	for (let px = width - 1; px >= 0; px--) {
		const ptStart = Math.floor(px * stride);
		const ptEnd = Math.min(Math.floor((px + 1) * stride), pointCount - 1);

		let maxRms = 0;

		for (let pt = ptStart; pt <= ptEnd; pt++) {
			const rms = rmsEnvelope[pt]!;

			if (rms > maxRms) maxRms = rms;
		}

		context.lineTo(px, centerY + maxRms * halfHeight);
	}

	context.closePath();
	context.fillStyle = color;
	context.fill();
}

function drawLufsLine(lufsData: Float32Array, pointCount: number, color: string, dimensions: Dimensions, context: CanvasRenderingContext2D): void {
	const { width, height } = dimensions;

	if (pointCount === 0) return;

	const stride = (pointCount - 1) / width;

	context.beginPath();
	context.moveTo(0, lufsToY(lufsData[0]!, height));

	for (let px = 1; px < width; px++) {
		const pt = Math.min(Math.round(px * stride), pointCount - 1);

		context.lineTo(px, lufsToY(lufsData[pt]!, height));
	}

	context.strokeStyle = color;
	context.lineWidth = 1.5;
	context.stroke();
}

function drawAmplitudeLine(amplitude: number, color: string, dimensions: Dimensions, context: CanvasRenderingContext2D): void {
	const { width, height } = dimensions;

	if (amplitude <= 0) return;

	const py = height / 2 - amplitude * (height / 2);

	context.beginPath();
	context.setLineDash([6, 4]);
	context.moveTo(0, py);
	context.lineTo(width, py);
	context.strokeStyle = color;
	context.lineWidth = 1.5;
	context.stroke();
	context.setLineDash([]);
}

function drawIntegratedLine(integratedLufs: number, color: string, dimensions: Dimensions, context: CanvasRenderingContext2D): void {
	const { width, height } = dimensions;

	if (!isFinite(integratedLufs) || integratedLufs < -60) return;

	const py = lufsToY(integratedLufs, height);

	context.beginPath();
	context.setLineDash([6, 4]);
	context.moveTo(0, py);
	context.lineTo(width, py);
	context.strokeStyle = color;
	context.lineWidth = 1.5;
	context.stroke();
	context.setLineDash([]);
}

export const LoudnessCanvas: React.FC<LoudnessCanvasProps> = ({ computeResult, rmsEnvelope = true, momentary = false, shortTerm = false, integrated = true, truePeak = false, colors }) => {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	const resolvedColors = {
		rms: colors?.rms ?? DEFAULT_COLORS.rms,
		momentary: colors?.momentary ?? DEFAULT_COLORS.momentary,
		shortTerm: colors?.shortTerm ?? DEFAULT_COLORS.shortTerm,
		integrated: colors?.integrated ?? DEFAULT_COLORS.integrated,
		truePeak: colors?.truePeak ?? DEFAULT_COLORS.truePeak,
	};

	const dimensions = computeResult.status === "ready" ? computeResult.options.sampleQuery : { width: 0, height: 0 };
	const { width, height } = dimensions;

	useEffect(() => {
		const canvasElement = canvasRef.current;

		if (!canvasElement) return;

		const context = canvasElement.getContext("2d");

		if (!context) return;

		context.clearRect(0, 0, width, height);

		if (computeResult.status !== "ready") return;

		const { loudnessData } = computeResult;

		if (!loudnessData || loudnessData.pointCount < 2) return;

		if (rmsEnvelope) {
			drawRmsEnvelope(loudnessData, resolvedColors.rms, dimensions, context);
		}

		if (momentary) {
			drawLufsLine(loudnessData.momentaryLufs, loudnessData.pointCount, resolvedColors.momentary, dimensions, context);
		}

		if (shortTerm) {
			drawLufsLine(loudnessData.shortTermLufs, loudnessData.pointCount, resolvedColors.shortTerm, dimensions, context);
		}

		if (integrated) {
			drawIntegratedLine(loudnessData.integratedLufs, resolvedColors.integrated, dimensions, context);
		}

		if (truePeak && loudnessData.truePeak !== undefined) {
			drawAmplitudeLine(loudnessData.truePeak, resolvedColors.truePeak, dimensions, context);
		}
	}, [computeResult, width, height, rmsEnvelope, momentary, shortTerm, integrated, truePeak, resolvedColors.rms, resolvedColors.momentary, resolvedColors.shortTerm, resolvedColors.integrated, resolvedColors.truePeak]);

	if (computeResult.status !== "ready" || !computeResult.loudnessData) return null;

	return (
		<canvas
			ref={canvasRef}
			width={width}
			height={height}
		/>
	);
};
