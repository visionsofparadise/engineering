import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { read } from "./sources/read";
import { write } from "./targets/write";
import { BufferedTransformStream, TransformNode, WHOLE_FILE } from "./transform";
import { readWavSamples } from "./utils/read-to-buffer";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";
import type { BufferedAudioNodeProperties, StreamContext } from "./node";
import type { ChunkBuffer } from "./chunk-buffer";

const testVoice = join(import.meta.dirname, "./utils/test-voice.wav");

class PassthroughTransform extends TransformNode {
	static override readonly moduleName = "Passthrough";
	override readonly type = ["async-module", "transform", "passthrough"] as const;
	readonly bufferSize = 0;
	readonly latency = 0;

	protected override createStream(context: StreamContext): BufferedTransformStream {
		return new BufferedTransformStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	clone(overrides?: Partial<BufferedAudioNodeProperties>): PassthroughTransform {
		return new PassthroughTransform({ ...this.properties, ...overrides });
	}
}

class ErrorStream extends BufferedTransformStream {
	override async _process(_buffer: ChunkBuffer): Promise<void> {
		throw new Error("Intentional _process error");
	}
}

class ErrorTransform extends TransformNode {
	static override readonly moduleName = "Error";
	override readonly type = ["async-module", "transform", "error"] as const;
	readonly bufferSize = WHOLE_FILE;
	readonly latency = 0;

	protected override createStream(context: StreamContext): ErrorStream {
		return new ErrorStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 }, context);
	}

	clone(overrides?: Partial<BufferedAudioNodeProperties>): ErrorTransform {
		return new ErrorTransform({ ...this.properties, ...overrides });
	}
}

describe("TransformNode lifecycle", () => {
	it("renders the same pipeline twice with correct output both times", async () => {
		const tempOut = join(tmpdir(), `acm-multi-render-${randomBytes(8).toString("hex")}.wav`);
		const original = await readWavSamples(testVoice);

		try {
			const source = read(testVoice);
			const transform = new PassthroughTransform();
			const target = write(tempOut, { bitDepth: "32f" });

			source.to(transform);
			transform.to(target);

			await source.render();

			const result1 = await readWavSamples(tempOut);
			expect(result1.sampleRate).toBe(original.sampleRate);
			expect(result1.durationFrames).toBe(original.durationFrames);

			await source.render();

			const result2 = await readWavSamples(tempOut);
			expect(result2.sampleRate).toBe(original.sampleRate);
			expect(result2.durationFrames).toBe(original.durationFrames);

			const compareLength = Math.min(1000, original.durationFrames);
			const origCh0 = original.samples[0]!;
			const result2Ch0 = result2.samples[0]!;

			for (let i = 0; i < compareLength; i++) {
				expect(result2Ch0[i]).toBeCloseTo(origCh0[i]!, 4);
			}
		} finally {
			await unlink(tempOut).catch(() => undefined);
		}
	}, 240_000);

	it("propagates errors from _process without hanging", async () => {
		const tempOut = join(tmpdir(), `acm-error-${randomBytes(8).toString("hex")}.wav`);

		try {
			const source = read(testVoice);
			const transform = new ErrorTransform();
			const target = write(tempOut, { bitDepth: "32f" });

			source.to(transform);
			transform.to(target);

			await expect(source.render()).rejects.toThrow("Intentional _process error");
		} finally {
			await unlink(tempOut).catch(() => undefined);
		}
	}, 240_000);
});
