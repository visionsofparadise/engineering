import { useEffect, useRef } from "react";
import { BlitRenderer } from "./engine/blit";
import { WAVEFORM_VISUALIZE_SHADER } from "./engine/shaders";
import { useCanvasRef } from "./useCanvasRef";
import type { ComputeResult } from "./useSpectralCompute";

interface WaveformCanvasProps {
	computeResult: ComputeResult;
	ref?: React.Ref<HTMLCanvasElement>;
	color?: [number, number, number];
}

const DEFAULT_WAVEFORM_COLOR: [number, number, number] = [0, 255, 0];

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({ computeResult, ref, color = DEFAULT_WAVEFORM_COLOR }) => {
	const [internalCanvasReference, canvasCallback] = useCanvasRef(ref);
	const blitReference = useRef<BlitRenderer | null>(null);
	const blitDeviceRef = useRef<GPUDevice | null>(null);
	const pipelineReference = useRef<GPUComputePipeline | null>(null);
	const waveformGpuBufferRef = useRef<GPUBuffer | null>(null);
	const outputTextureRef = useRef<GPUTexture | null>(null);
	const uniformBufferRef = useRef<GPUBuffer | null>(null);
	const bindGroupRef = useRef<GPUBindGroup | null>(null);
	const lastComputeResultRef = useRef<ComputeResult | null>(null);
	const lastDimensionsRef = useRef<{ width: number; height: number } | null>(null);

	useEffect(() => {
		const canvas = internalCanvasReference.current;

		if (!canvas || computeResult.status !== "ready" || !computeResult.waveformBuffer || computeResult.waveformPointCount === 0) {
			return;
		}

		const { device } = computeResult.options.config;
		const { width, height } = computeResult.options.sampleQuery;
		const { waveformBuffer, waveformPointCount } = computeResult;

		if (blitReference.current && blitDeviceRef.current !== device) {
			blitReference.current.destroy();
			blitReference.current = null;
			pipelineReference.current = null;
			waveformGpuBufferRef.current?.destroy();
			waveformGpuBufferRef.current = null;
			outputTextureRef.current?.destroy();
			outputTextureRef.current = null;
			uniformBufferRef.current?.destroy();
			uniformBufferRef.current = null;
			bindGroupRef.current = null;
			lastComputeResultRef.current = null;
			lastDimensionsRef.current = null;
		}

		blitReference.current ??= new BlitRenderer(device, canvas);
		blitDeviceRef.current = device;

		if (!pipelineReference.current) {
			const shaderModule = device.createShaderModule({ code: WAVEFORM_VISUALIZE_SHADER });

			pipelineReference.current = device.createComputePipeline({
				layout: "auto",
				compute: {
					module: shaderModule,
					entryPoint: "main",
				},
			});
		}

		const pipeline = pipelineReference.current;
		const computeResultChanged = lastComputeResultRef.current !== computeResult;
		const buffersDestroyed = !uniformBufferRef.current;

		if (computeResultChanged || buffersDestroyed) {
			waveformGpuBufferRef.current?.destroy();
			outputTextureRef.current?.destroy();
			uniformBufferRef.current?.destroy();

			const gpuWaveformBuffer = device.createBuffer({
				size: waveformBuffer.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
				mappedAtCreation: true,
			});

			new Float32Array(gpuWaveformBuffer.getMappedRange()).set(waveformBuffer);
			gpuWaveformBuffer.unmap();

			const outputTexture = device.createTexture({
				size: { width, height },
				format: "rgba8unorm",
				usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
			});

			const uniformBuffer = device.createBuffer({
				size: 24,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			});

			const bindGroup = device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: gpuWaveformBuffer } },
					{ binding: 1, resource: outputTexture.createView() },
					{ binding: 2, resource: { buffer: uniformBuffer } },
				],
			});

			waveformGpuBufferRef.current = gpuWaveformBuffer;
			outputTextureRef.current = outputTexture;
			uniformBufferRef.current = uniformBuffer;
			bindGroupRef.current = bindGroup;
			lastComputeResultRef.current = computeResult;
			lastDimensionsRef.current = { width, height };
		}

		const uniformData = new ArrayBuffer(24);
		const uniforms = new DataView(uniformData);

		uniforms.setUint32(0, waveformPointCount, true);
		uniforms.setUint32(4, width, true);
		uniforms.setUint32(8, height, true);
		uniforms.setFloat32(12, color[0], true);
		uniforms.setFloat32(16, color[1], true);
		uniforms.setFloat32(20, color[2], true);

		device.queue.writeBuffer(uniformBufferRef.current!, 0, uniformData);

		const commandEncoder = device.createCommandEncoder();
		const computePass = commandEncoder.beginComputePass();

		computePass.setPipeline(pipeline);
		computePass.setBindGroup(0, bindGroupRef.current);
		computePass.dispatchWorkgroups(Math.ceil(width / 64));
		computePass.end();

		device.queue.submit([commandEncoder.finish()]);

		blitReference.current.resize(width, height);
		blitReference.current.render(outputTextureRef.current!);
	}, [computeResult, color[0], color[1], color[2]]);

	useEffect(
		() => () => {
			blitReference.current?.destroy();
			blitReference.current = null;
			pipelineReference.current = null;
			waveformGpuBufferRef.current?.destroy();
			waveformGpuBufferRef.current = null;
			outputTextureRef.current?.destroy();
			outputTextureRef.current = null;
			uniformBufferRef.current?.destroy();
			uniformBufferRef.current = null;
			bindGroupRef.current = null;
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
