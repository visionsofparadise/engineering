import type { AudioChunk, StreamContext } from "../module";
import type { TransformModule } from "../transform";

export async function applyTransform(
	samples: Array<Float32Array>,
	context: StreamContext,
	transform: TransformModule,
): Promise<Array<Float32Array>> {
	await transform.setup(context);

	try {
		const stream = transform.createTransform();
		const writer = stream.writable.getWriter();
		const reader = stream.readable.getReader();

		const frames = samples[0]?.length ?? 0;

		await writer.write({ samples, offset: 0, duration: frames });
		await writer.close();

		const outputChunks: Array<AudioChunk> = [];

		for (;;) {
			const { value, done } = await reader.read();

			if (done) break;

			outputChunks.push(value);
		}

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
