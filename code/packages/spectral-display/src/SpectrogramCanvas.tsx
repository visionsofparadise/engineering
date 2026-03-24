import { useEffect, useRef } from "react";
import { BlitRenderer } from "./engine/blit";
import { useCanvasRef } from "./useCanvasRef";
import type { ComputeResult } from "./useSpectralCompute";

interface SpectrogramCanvasProps {
	computeResult: ComputeResult;
	ref?: React.Ref<HTMLCanvasElement>;
}

export const SpectrogramCanvas: React.FC<SpectrogramCanvasProps> = ({ computeResult, ref }) => {
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

		blitReference.current.resize(width, height);
		blitReference.current.render(computeResult.spectrogramTexture);
	}, [computeResult]);

	useEffect(
		() => () => {
			blitReference.current?.destroy();
			blitReference.current = null;
		},
		[],
	);

	const { width, height } = computeResult.status === "ready" ? computeResult.options.sampleQuery : { width: 0, height: 0 };

	return (
		<canvas
			ref={canvasCallback}
			width={width}
			height={height}
		/>
	);
};
