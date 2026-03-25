import { useEffect, useRef } from "react";
import { BlitRenderer } from "./engine/blit";
import { useCanvasRef } from "./useCanvasRef";
import type { ComputeResult } from "./useSpectralCompute";

interface SpectrogramCanvasProps {
	computeResult: ComputeResult;
	ref?: React.Ref<HTMLCanvasElement>;
	/** Render canvas at this multiple of the compute resolution (default 1). Use window.devicePixelRatio for smooth upsampling. */
	canvasScale?: number;
}

export const SpectrogramCanvas: React.FC<SpectrogramCanvasProps> = ({ computeResult, ref, canvasScale = 1 }) => {
	const [internalCanvasReference, canvasCallback] = useCanvasRef(ref);
	const blitReference = useRef<BlitRenderer | null>(null);
	const blitDeviceRef = useRef<GPUDevice | null>(null);

	useEffect(() => {
		const canvas = internalCanvasReference.current;

		if (!canvas || computeResult.status !== "ready" || !computeResult.spectrogramTexture) {
			return;
		}

		const { device } = computeResult.options.config;
		const { width, height } = computeResult.options.sampleQuery;

		if (blitReference.current && blitDeviceRef.current !== device) {
			blitReference.current.destroy();
			blitReference.current = null;
		}

		blitReference.current ??= new BlitRenderer(device, canvas);
		blitDeviceRef.current = device;

		// Resize canvas to scaled dimensions — linear sampler upsamples the texture
		const canvasWidth = Math.round(width * canvasScale);
		const canvasHeight = Math.round(height * canvasScale);

		blitReference.current.resize(canvasWidth, canvasHeight);
		blitReference.current.render(computeResult.spectrogramTexture);
	}, [computeResult, canvasScale]);

	useEffect(
		() => () => {
			blitReference.current?.destroy();
			blitReference.current = null;
		},
		[],
	);

	const { width, height } = computeResult.status === "ready" ? computeResult.options.sampleQuery : { width: 0, height: 0 };
	const canvasWidth = Math.round(width * canvasScale);
	const canvasHeight = Math.round(height * canvasScale);

	return (
		<canvas
			ref={canvasCallback}
			width={canvasWidth}
			height={canvasHeight}
		/>
	);
};
