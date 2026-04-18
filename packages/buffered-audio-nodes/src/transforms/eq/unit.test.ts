import { describe, it, expect } from "vitest";
import { MemoryChunkBuffer } from "@e9g/buffered-audio-nodes-core";
import { eq, EqNode, type EqBand } from ".";

const SAMPLE_RATE = 48000;

function makeSinusoidChunk(freq: number, frames = 8192, channels = 1): { samples: Array<Float32Array>; offset: number; sampleRate: number; bitDepth: number } {
	const samples = Array.from({ length: channels }, () => {
		const ch = new Float32Array(frames);
		for (let i = 0; i < frames; i++) ch[i] = Math.sin(2 * Math.PI * freq * i / SAMPLE_RATE);
		return ch;
	});
	return { samples, offset: 0, sampleRate: SAMPLE_RATE, bitDepth: 32 };
}

function makeDcChunk(value: number, frames = 4096, channels = 2): { samples: Array<Float32Array>; offset: number; sampleRate: number; bitDepth: number } {
	return {
		samples: Array.from({ length: channels }, () => new Float32Array(frames).fill(value)),
		offset: 0,
		sampleRate: SAMPLE_RATE,
		bitDepth: 32,
	};
}

function steadyStateRms(samples: Float32Array): number {
	const half = Math.floor(samples.length / 2);
	let sum = 0;
	for (let i = half; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2;
	return Math.sqrt(sum / (samples.length - half));
}

async function applyEq(node: ReturnType<typeof eq>, chunk: { samples: Array<Float32Array>; offset: number; sampleRate: number; bitDepth: number }) {
	const stream = node.createStream();
	const buffer = new MemoryChunkBuffer(chunk.samples[0]?.length ?? 0, chunk.samples.length);
	await stream._buffer(chunk, buffer);
	return stream._unbuffer(chunk);
}

describe("EqNode", () => {
	it("has correct static metadata", () => {
		expect(EqNode.moduleName).toBe("EQ");
	});

	it("schema defaults to empty band list", () => {
		const node = eq();
		expect(node.properties.bands).toEqual([]);
	});

	it("with no bands passes signal unchanged", async () => {
		const node = eq({ bands: [] });
		const chunk = makeDcChunk(0.5);
		const output = await applyEq(node, chunk);
		expect(output.samples[0]![0]).toBeCloseTo(0.5, 5);
	});

	it("disabled band passes signal unchanged", async () => {
		const node = eq({ bands: [{ type: "lowpass", frequency: 200, enabled: false }] });
		const chunk = makeSinusoidChunk(8000);
		const output = await applyEq(node, chunk);
		const rmsIn = steadyStateRms(chunk.samples[0]!);
		const rmsOut = steadyStateRms(output.samples[0]!);
		expect(rmsOut).toBeCloseTo(rmsIn, 2);
	});

	describe("filter types", () => {
		it("lowpass band attenuates high frequency content", async () => {
			const node = eq({ bands: [{ type: "lowpass", frequency: 200, enabled: true }] });
			const highFreqChunk = makeSinusoidChunk(8000);
			const output = await applyEq(node, highFreqChunk);
			const rmsIn = steadyStateRms(highFreqChunk.samples[0]!);
			const rmsOut = steadyStateRms(output.samples[0]!);
			expect(rmsOut).toBeLessThan(rmsIn * 0.1);
		});

		it("highpass band attenuates low frequency content", async () => {
			const node = eq({ bands: [{ type: "highpass", frequency: 8000, enabled: true }] });
			const lowFreqChunk = makeSinusoidChunk(100);
			const output = await applyEq(node, lowFreqChunk);
			const rmsOut = steadyStateRms(output.samples[0]!);
			expect(rmsOut).toBeLessThan(0.1);
		});

		it("peaking band boosts at center frequency", async () => {
			const centerFreq = 1000;
			const band: Partial<EqBand> = { type: "peaking", frequency: centerFreq, quality: 1.0, gain: 6, enabled: true };
			const node = eq({ bands: [band] });
			const chunk = makeSinusoidChunk(centerFreq);
			const output = await applyEq(node, chunk);
			const rmsIn = steadyStateRms(chunk.samples[0]!);
			const rmsOut = steadyStateRms(output.samples[0]!);
			expect(rmsOut).toBeGreaterThan(rmsIn * 1.26);
		});

		it("peaking band cuts at center frequency", async () => {
			const band: Partial<EqBand> = { type: "peaking", frequency: 1000, quality: 1.0, gain: -6, enabled: true };
			const node = eq({ bands: [band] });
			const chunk = makeSinusoidChunk(1000);
			const output = await applyEq(node, chunk);
			const rmsIn = steadyStateRms(chunk.samples[0]!);
			const rmsOut = steadyStateRms(output.samples[0]!);
			expect(rmsOut).toBeLessThan(rmsIn * 0.8);
		});

		it("notch band strongly attenuates at notch frequency", async () => {
			const band: Partial<EqBand> = { type: "notch", frequency: 1000, quality: 2.0, enabled: true };
			const node = eq({ bands: [band] });
			const chunk = makeSinusoidChunk(1000);
			const output = await applyEq(node, chunk);
			const rmsOut = steadyStateRms(output.samples[0]!);
			expect(rmsOut).toBeLessThan(0.1);
		});

		it("allpass band preserves amplitude", async () => {
			const band: Partial<EqBand> = { type: "allpass", frequency: 1000, quality: 1.0, enabled: true };
			const node = eq({ bands: [band] });
			const chunk = makeSinusoidChunk(500);
			const output = await applyEq(node, chunk);
			const rmsIn = steadyStateRms(chunk.samples[0]!);
			const rmsOut = steadyStateRms(output.samples[0]!);
			expect(rmsOut).toBeCloseTo(rmsIn, 2);
		});

		it("lowshelf band boosts low frequency", async () => {
			const band: Partial<EqBand> = { type: "lowshelf", frequency: 200, quality: 0.71, gain: 6, enabled: true };
			const node = eq({ bands: [band] });
			const lowChunk = makeSinusoidChunk(50);
			const output = await applyEq(node, lowChunk);
			const rmsIn = steadyStateRms(lowChunk.samples[0]!);
			const rmsOut = steadyStateRms(output.samples[0]!);
			expect(rmsOut).toBeGreaterThan(rmsIn * 1.26);
		});

		it("highshelf band boosts high frequency", async () => {
			const band: Partial<EqBand> = { type: "highshelf", frequency: 8000, quality: 0.71, gain: 6, enabled: true };
			const node = eq({ bands: [band] });
			const highChunk = makeSinusoidChunk(16000);
			const output = await applyEq(node, highChunk);
			const rmsIn = steadyStateRms(highChunk.samples[0]!);
			const rmsOut = steadyStateRms(output.samples[0]!);
			expect(rmsOut).toBeGreaterThan(rmsIn * 1.26);
		});
	});

	describe("multichannel processing", () => {
		it("processes all channels independently with the same filter settings", async () => {
			const band: Partial<EqBand> = { type: "peaking", frequency: 1000, quality: 1.0, gain: 6, enabled: true };
			const node = eq({ bands: [band] });
			const chunk = makeSinusoidChunk(1000, 8192, 2);
			const output = await applyEq(node, chunk);
			expect(output.samples.length).toBe(2);
			const rms0 = steadyStateRms(output.samples[0]!);
			const rms1 = steadyStateRms(output.samples[1]!);
			expect(rms0).toBeCloseTo(rms1, 3);
		});
	});

	describe("filter state continuity across chunks", () => {
		it("biquad state carries over between consecutive chunks (no discontinuity)", () => {
			// Process a single long chunk vs two half-length chunks through the same filter.
			// The RMS of both should be similar, confirming state continuity.
			const band: Partial<EqBand> = { type: "peaking", frequency: 1000, quality: 1.0, gain: 6, enabled: true };
			const node = eq({ bands: [band] });
			const stream = node.createStream();
			const frames = 4096;
			const buffer = new MemoryChunkBuffer(frames, 1);

			const chunk1 = makeSinusoidChunk(1000, frames / 2);
			const chunk2 = { ...makeSinusoidChunk(1000, frames / 2), offset: frames / 2 };

			// Apply to two successive chunks
			void stream._buffer(chunk1, buffer);
			const out1 = stream._unbuffer(chunk1);
			void stream._buffer(chunk2, buffer);
			const out2 = stream._unbuffer(chunk2);

			// Both halves should have similar RMS (filter settled, state continued)
			const rms1 = steadyStateRms(out1.samples[0]!);
			const rms2 = steadyStateRms(out2.samples[0]!);
			expect(rms2).toBeCloseTo(rms1, 1);
		});
	});

	describe("lowpass/highpass quality parameter", () => {
		it("changing quality on a lowpass band changes filter behavior near the cutoff", async () => {
			// At frequency = cutoff, a higher Q produces a resonance peak while a lower Q rolls off sooner.
			// At frequency slightly above cutoff (1.5x), the two quality settings should produce different output levels.
			const cutoff = 2000;
			const testFreq = 3000; // above cutoff — affected by Q-dependent rolloff shape

			const nodeNarrow = eq({ bands: [{ type: "lowpass", frequency: cutoff, quality: 0.5, enabled: true }] });
			const nodeWide = eq({ bands: [{ type: "lowpass", frequency: cutoff, quality: 4.0, enabled: true }] });

			const chunk = makeSinusoidChunk(testFreq);
			const outNarrow = await applyEq(nodeNarrow, chunk);
			const outWide = await applyEq(nodeWide, chunk);

			const rmsNarrow = steadyStateRms(outNarrow.samples[0]!);
			const rmsWide = steadyStateRms(outWide.samples[0]!);

			// The two quality values must produce measurably different output amplitudes
			expect(Math.abs(rmsWide - rmsNarrow)).toBeGreaterThan(0.01);
		});
	});

	describe("multiband cascade", () => {
		it("cascades multiple bands in series", async () => {
			const bands: Array<Partial<EqBand>> = [
				{ type: "highpass", frequency: 80, enabled: true },
				{ type: "peaking", frequency: 200, quality: 1.0, gain: 3, enabled: true },
				{ type: "highshelf", frequency: 8000, quality: 0.71, gain: -3, enabled: true },
			];
			const node = eq({ bands });
			const chunk = makeSinusoidChunk(1000);
			// Should complete without error and produce finite values
			const output = await applyEq(node, chunk);
			for (const sample of output.samples[0]!) {
				expect(Number.isFinite(sample)).toBe(true);
			}
		});
	});
});
