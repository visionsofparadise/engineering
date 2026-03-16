import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { read } from "./sources/read";
import { write } from "./targets/write";
import { TransformModule, WHOLE_FILE } from "./transform";
import { readWavSamples } from "./utils/read-to-buffer";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { unlink } from "node:fs/promises";
import type { AudioChainModuleProperties, AudioChunk } from "./module";
import type { ChunkBuffer } from "./chunk-buffer";
import type { TransformModuleProperties } from "./transform";

const testVoice = join(import.meta.dirname, "./utils/test-voice.wav");

/** A passthrough transform that does nothing — used to test pipeline lifecycle. */
class PassthroughTransform extends TransformModule {
	static override readonly moduleName = "Passthrough";
	override readonly type = ["async-module", "transform", "passthrough"] as const;
	readonly bufferSize = 0;
	readonly latency = 0;

	clone(overrides?: Partial<AudioChainModuleProperties>): PassthroughTransform {
		return new PassthroughTransform({ ...this.properties, ...overrides });
	}
}

/** A transform that throws an error during _process. */
class ErrorTransform extends TransformModule {
	static override readonly moduleName = "Error";
	override readonly type = ["async-module", "transform", "error"] as const;
	readonly bufferSize = WHOLE_FILE;
	readonly latency = 0;

	override async _process(_buffer: ChunkBuffer): Promise<void> {
		throw new Error("Intentional _process error");
	}

	clone(overrides?: Partial<AudioChainModuleProperties>): ErrorTransform {
		return new ErrorTransform({ ...this.properties, ...overrides });
	}
}

describe("TransformModule lifecycle", () => {
	it("renders the same pipeline twice with correct output both times", async () => {
		const tempOut = join(tmpdir(), `acm-multi-render-${randomBytes(8).toString("hex")}.wav`);
		const original = await readWavSamples(testVoice);

		try {
			const source = read(testVoice);
			const transform = new PassthroughTransform();
			const target = write(tempOut, { bitDepth: "32f" });

			source.to(transform);
			transform.to(target);

			// First render
			await source.render();

			const result1 = await readWavSamples(tempOut);
			expect(result1.sampleRate).toBe(original.sampleRate);
			expect(result1.duration).toBe(original.duration);

			// Second render — catches bufferOffset reset bugs
			await source.render();

			const result2 = await readWavSamples(tempOut);
			expect(result2.sampleRate).toBe(original.sampleRate);
			expect(result2.duration).toBe(original.duration);

			// Verify sample data is correct on the second render
			const compareLength = Math.min(1000, original.duration);
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
