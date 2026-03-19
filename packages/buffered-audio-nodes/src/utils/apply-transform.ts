import type { AudioChunk, ExecutionProvider, StreamMeta } from "../node";
import type { TransformNode } from "../transform";

const defaultProviders: ReadonlyArray<ExecutionProvider> = ["gpu", "cpu-native", "cpu"];

export async function applyTransform(
	samples: Array<Float32Array>,
	context: StreamMeta,
	transform: TransformNode,
): Promise<Array<Float32Array>> {
	await transform.setup({ ...context, executionProviders: defaultProviders, memoryLimit: 256 * 1024 * 1024 });

	try {
		const stream = transform.createTransform();
		const writer = stream.writable.getWriter();
		const reader = stream.readable.getReader();

		const frames = samples[0]?.length ?? 0;

		const outputChunks: Array<AudioChunk> = [];

		// Write and read concurrently to avoid TransformStream backpressure deadlock
		const writePromise = (async () => {
			await writer.write({ samples, offset: 0, duration: frames });
			await writer.close();
		})();

		const readPromise = (async () => {
			for (;;) {
				const { value, done } = await reader.read();

				if (done) break;

				outputChunks.push(value);
			}
		})();

		await Promise.all([writePromise, readPromise]);

		const totalFrames = outputChunks.reduce((sum, chunk) => sum + chunk.duration, 0);
		const outChannels = outputChunks[0]?.samples.length ?? samples.length;
		const result: Array<Float32Array> = [];

		for (let ch = 0; ch < outChannels; ch++) {
			const data = new Float32Array(totalFrames);
			let pos = 0;

			for (const chunk of outputChunks) {
				const chData = chunk.samples[ch];

				if (chData) data.set(chData, pos);

				pos += chunk.duration;
			}

			result.push(data);
		}

		return result;
	} finally {
		await transform.teardown();
	}
}
