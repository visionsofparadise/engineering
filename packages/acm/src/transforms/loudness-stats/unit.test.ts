import { describe, it, expect } from "vitest";
import { LoudnessStatsTransformModule, loudnessStats } from ".";
import { ChunkBuffer } from "../../chunk-buffer";

describe("LoudnessStatsTransformModule", () => {
	it("measures integrated loudness of a sine wave", async () => {
		const sampleRate = 48000;
		const duration = 2;
		const frames = sampleRate * duration;
		const amplitude = 0.5;

		const samples = new Float32Array(frames);

		for (let i = 0; i < frames; i++) {
			samples[i] = amplitude * Math.sin((2 * Math.PI * 1000 * i) / sampleRate);
		}

		const unit = loudnessStats();
		await unit.setup({ sampleRate, channels: 1, duration: frames });

		const buffer = new ChunkBuffer(frames, 1);

		await unit._buffer({ samples: [samples], offset: 0, duration: frames }, buffer);
		await unit._process(buffer);

		expect(unit.stats).toBeDefined();
		expect(unit.stats!.integrated).toBeLessThan(0);
		expect(unit.stats!.integrated).toBeGreaterThan(-30);
		expect(unit.stats!.truePeak).toBeLessThan(0);
		expect(unit.stats!.momentary.length).toBeGreaterThan(0);

		await buffer.close();
	});

	it("measures silence as very low loudness", async () => {
		const sampleRate = 48000;
		const frames = sampleRate * 2;
		const samples = new Float32Array(frames).fill(0);

		const unit = loudnessStats();
		await unit.setup({ sampleRate, channels: 1, duration: frames });

		const buffer = new ChunkBuffer(frames, 1);
		await buffer.append([samples]);

		await unit._process(buffer);

		expect(unit.stats).toBeDefined();
		expect(unit.stats!.integrated).toBe(-Infinity);

		await buffer.close();
	});
});
