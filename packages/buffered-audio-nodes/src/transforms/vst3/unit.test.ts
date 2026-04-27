import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { FileChunkBuffer, type StreamContext } from "@e9g/buffered-audio-nodes-core";
import { schema, vst3, Vst3Node, Vst3PassthroughStream, Vst3Stream } from ".";

const stubBinary = fileURLToPath(new URL("./__fixtures__/stub-binary.mjs", import.meta.url));

const buildContext = (): StreamContext => ({
	executionProviders: ["cpu"],
	memoryLimit: 64 * 1024 * 1024,
	highWaterMark: 1,
	visited: new Set(),
});

const dummyInput = (): ReadableStream => new ReadableStream({ start: (controller) => controller.close() });

const populate = async (channels: Array<Float32Array>, sampleRate = 44100): Promise<FileChunkBuffer> => {
	const buffer = new FileChunkBuffer(0, channels.length, 64 * 1024 * 1024);

	await buffer.append(channels, sampleRate, 32);

	return buffer;
};

describe("Vst3Node schema", () => {
	it("accepts a valid configuration", () => {
		const result = schema.parse({
			vstHostPath: "/path/to/vst-host",
			pluginPath: "/path/to/plugin.vst3",
			presetPath: "/path/to/preset.vstpreset",
			bypass: false,
		});

		expect(result.vstHostPath).toBe("/path/to/vst-host");
		expect(result.pluginPath).toBe("/path/to/plugin.vst3");
		expect(result.presetPath).toBe("/path/to/preset.vstpreset");
		expect(result.bypass).toBe(false);
	});

	it("applies defaults for optional fields", () => {
		const result = schema.parse({ pluginPath: "/path/to/plugin.vst3" });

		expect(result.vstHostPath).toBe("");
		expect(result.bypass).toBe(false);
		expect(result.presetPath).toBeUndefined();
	});

	it("rejects missing pluginPath", () => {
		const result = schema.safeParse({});

		expect(result.success).toBe(false);
	});

	it("rejects non-string presetPath", () => {
		const result = schema.safeParse({ pluginPath: "/p", presetPath: 42 });

		expect(result.success).toBe(false);
	});

	it("rejects non-boolean bypass", () => {
		const result = schema.safeParse({ pluginPath: "/p", bypass: "yes" });

		expect(result.success).toBe(false);
	});

	it("rejects non-string pluginPath", () => {
		const result = schema.safeParse({ pluginPath: 42 });

		expect(result.success).toBe(false);
	});
});

describe("Vst3Node", () => {
	it("identifies VST3 nodes via .is()", () => {
		const node = vst3({ vstHostPath: "x", pluginPath: "y" });

		expect(Vst3Node.is(node)).toBe(true);
		expect(node.type[2]).toBe("vst3");
	});

	it("exposes the expected static metadata", () => {
		expect(Vst3Node.moduleName).toBe("VST3");
		expect(Vst3Node.moduleDescription).toBe("Host a VST3 effect plugin via Pedalboard");
	});

	it("returns a passthrough stream when bypass is true", () => {
		const node = vst3({ vstHostPath: "/none", pluginPath: "/none", bypass: true });
		const stream = node.createStream();

		expect(stream).toBeInstanceOf(Vst3PassthroughStream);
		expect(stream).not.toBeInstanceOf(Vst3Stream);
	});

	it("returns a Vst3Stream when bypass is false", () => {
		const node = vst3({ vstHostPath: "/none", pluginPath: "/none", bypass: false });
		const stream = node.createStream();

		expect(stream).toBeInstanceOf(Vst3Stream);
	});
});

describe("Vst3Node bypass short-circuit", () => {
	it("passes audio through unchanged sample-for-sample when bypass is true", async () => {
		const node = vst3({ vstHostPath: "/missing/binary", pluginPath: "/missing/plugin.vst3", bypass: true });
		const stream = node.createStream();

		// The passthrough stream must NOT spawn a subprocess; use a missing path
		// to make any spawn attempt fail loudly. This test relying purely on the
		// public Vst3PassthroughStream type already proves the node short-
		// circuits. As an additional behavioural check, run audio through it.
		await stream.setup(dummyInput(), buildContext());

		const samples = [Float32Array.from([0.1, -0.2, 0.3, -0.4, 0.5]), Float32Array.from([-0.1, 0.2, -0.3, 0.4, -0.5])];
		const buffer = await populate(samples);

		const before: Array<Float32Array> = samples.map((channel) => Float32Array.from(channel));

		stream._process(buffer);

		const after = await buffer.read(0, buffer.frames);

		for (let ch = 0; ch < samples.length; ch++) {
			const original = before[ch]!;
			const result = after.samples[ch]!;

			expect(result.length).toBe(original.length);

			for (let i = 0; i < original.length; i++) {
				expect(result[i]).toBe(original[i]);
			}
		}

		await buffer.close();
	});
});

describe("Vst3Stream subprocess lifecycle", () => {
	it("spawns the stub binary, receives READY, processes a chunk, and tears down cleanly", async () => {
		// The stub mimics the vst-host contract: prints READY then echoes stdin.
		// We pass `node` as the binary path and the stub script as an extra arg
		// before the canonical `--plugin-path ...` argument list.
		const stream = new Vst3Stream({
			vstHostPath: process.execPath,
			pluginPath: "/dev/null/ignored-by-stub.vst3",
			extraArgs: [stubBinary],
			bufferSize: 4096,
			overlap: 0,
		});

		await stream.setup(dummyInput(), buildContext());

		const channels = 2;
		const frames = 4096;
		const samples: Array<Float32Array> = [];

		for (let ch = 0; ch < channels; ch++) {
			const arr = new Float32Array(frames);

			for (let i = 0; i < frames; i++) arr[i] = Math.sin((i / frames) * Math.PI * 2 * (ch + 1));

			samples.push(arr);
		}

		const buffer = await populate(samples);
		const before: Array<Float32Array> = samples.map((channel) => Float32Array.from(channel));

		await stream._process(buffer);

		const after = await buffer.read(0, buffer.frames);

		expect(after.samples.length).toBe(channels);
		expect(after.samples[0]!.length).toBe(frames);

		// The stub echoes stdin to stdout, so the output should match the input
		// sample-for-sample (after a round-trip through interleave/deinterleave).
		for (let ch = 0; ch < channels; ch++) {
			const original = before[ch]!;
			const result = after.samples[ch]!;

			for (let i = 0; i < frames; i++) {
				expect(result[i]).toBeCloseTo(original[i]!, 6);
			}
		}

		await stream._teardown();
		await buffer.close();
	}, 30_000);

	it("zero-pads a sub-block partial buffer (end-of-stream path) and emits the real frame count", async () => {
		// The framework guarantees `_process` receives exactly `bufferSize`
		// frames except at end-of-stream. This test exercises the end-of-stream
		// path directly — a partial buffer of < VST3_BLOCK_SIZE frames must be
		// zero-padded internally, sent through the subprocess, and the output
		// truncated back to the real frame count.
		const stream = new Vst3Stream({
			vstHostPath: process.execPath,
			pluginPath: "/dev/null/ignored-by-stub.vst3",
			extraArgs: [stubBinary],
			bufferSize: 4096,
			overlap: 0,
		});

		await stream.setup(dummyInput(), buildContext());

		const frames = 1500; // < VST3_BLOCK_SIZE = 4096
		const samples: Array<Float32Array> = [Float32Array.from({ length: frames }, (_, i) => i / frames)];
		const buffer = await populate(samples);
		const before = Float32Array.from(samples[0]!);

		await stream._process(buffer);

		const after = await buffer.read(0, buffer.frames);

		expect(after.samples[0]!.length).toBe(frames);

		// The stub echoes stdin to stdout, so the first `frames` samples of
		// the output equal the input (the trailing zero-pad is dropped).
		for (let i = 0; i < frames; i++) {
			expect(after.samples[0]![i]).toBeCloseTo(before[i]!, 6);
		}

		await stream._teardown();
		await buffer.close();
	}, 30_000);
});
