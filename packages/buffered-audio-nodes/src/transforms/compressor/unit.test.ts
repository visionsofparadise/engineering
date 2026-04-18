import { describe, it, expect } from "vitest";
import { compressor, CompressorNode } from ".";

const SAMPLE_RATE = 48000;

function makeConstantChunk(
	value: number,
	frames = 4096,
	channels = 1,
): { samples: Array<Float32Array>; offset: number; sampleRate: number; bitDepth: number } {
	return {
		samples: Array.from({ length: channels }, () => new Float32Array(frames).fill(value)),
		offset: 0,
		sampleRate: SAMPLE_RATE,
		bitDepth: 32,
	};
}

function processMultipleChunks(
	node: ReturnType<typeof compressor>,
	chunks: Array<ReturnType<typeof makeConstantChunk>>,
): Array<ReturnType<typeof makeConstantChunk>> {
	const stream = node.createStream();

	return chunks.map((chunk) => stream._unbuffer(chunk));
}

describe("CompressorNode", () => {
	it("has correct static metadata", () => {
		expect(CompressorNode.moduleName).toBe("Compressor");
		expect(CompressorNode.packageName).toBe(PACKAGE_NAME ?? "@e9g/buffered-audio-nodes");
	});

	it("schema defaults match compression presets", () => {
		const node = compressor();

		expect(node.properties.threshold).toBe(-24);
		expect(node.properties.ratio).toBe(4);
		expect(node.properties.attack).toBe(10);
		expect(node.properties.release).toBe(100);
		expect(node.properties.knee).toBe(6);
		expect(node.properties.makeupGain).toBe(0);
		expect(node.properties.detection).toBe("peak");
		expect(node.properties.stereoLink).toBe("average");
	});

	it("accepts overridden parameters via factory", () => {
		const node = compressor({ threshold: -12, ratio: 8 });

		expect(node.properties.threshold).toBe(-12);
		expect(node.properties.ratio).toBe(8);
	});

	it("compresses signal above threshold", () => {
		// -12dBFS signal, -24 threshold, 4:1 ratio, no attack/release
		const signal = Math.pow(10, -12 / 20);
		const node = compressor({ threshold: -24, ratio: 4, attack: 0, release: 0, knee: 0 });

		const chunks = Array.from({ length: 100 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);

		// Output must be less than input (compression is applied)
		expect(lastSample).toBeLessThan(signal);
	});

	it("does not compress signal below threshold", () => {
		// -48dBFS signal, -24 threshold -> no compression
		const signal = Math.pow(10, -48 / 20);
		const node = compressor({ threshold: -24, ratio: 4, attack: 0, release: 0, knee: 0 });

		const chunks = Array.from({ length: 50 }, () => makeConstantChunk(signal));
		const outputs = processMultipleChunks(node, chunks);
		const last = outputs[outputs.length - 1]!;
		const lastSample = Math.abs(last.samples[0]![0] ?? 0);

		expect(lastSample).toBeCloseTo(signal, 4);
	});

	it("produces finite output values", () => {
		const signal = Math.pow(10, -6 / 20);
		const node = compressor();

		const chunk = makeConstantChunk(signal);
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		for (const sample of output.samples[0]!) {
			expect(Number.isFinite(sample)).toBe(true);
		}
	});

	it("clone preserves and can override properties", () => {
		const node = compressor({ threshold: -18, ratio: 6 });
		const cloned = node.clone({ ratio: 2 });

		expect(cloned.properties.threshold).toBe(-18);
		expect(cloned.properties.ratio).toBe(2);
	});

	it("processes stereo input without errors", () => {
		const signal = Math.pow(10, -12 / 20);
		const node = compressor({ threshold: -24, ratio: 4, attack: 0, release: 0, knee: 0 });

		const chunk = makeConstantChunk(signal, 4096, 2);
		const stream = node.createStream();
		const output = stream._unbuffer(chunk);

		expect(output.samples).toHaveLength(2);
		expect(output.samples[0]).toHaveLength(4096);
		expect(output.samples[1]).toHaveLength(4096);
	});

	// CompressorNode is a wrapper; its stream class delegates to DynamicsStream
	it("type identifier is correct", () => {
		const node = compressor();

		expect(node.type[2]).toBe("compressor");
	});
});

// Import for PACKAGE_NAME reference
import { PACKAGE_NAME } from "../../package-metadata";
