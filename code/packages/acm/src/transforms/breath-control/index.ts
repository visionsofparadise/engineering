import { z } from "zod";
import { ChunkBuffer } from "../../chunk-buffer";
import { StreamContext } from "../../module";
import { TransformModule, type TransformModuleProperties } from "../../transform";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	reduction: z.number().min(-60).max(0).multipleOf(1).default(-12).describe("Reduction"),
	mode: z.enum(["remove", "attenuate"]).default("attenuate").describe("Mode"),
});

export interface BreathControlProperties extends z.infer<typeof schema>, TransformModuleProperties {}

export class BreathControlModule extends TransformModule<BreathControlProperties> {
	static override readonly moduleName = "Breath Control";
	static override readonly moduleDescription = "Attenuate or remove breath sounds between phrases";
	static override readonly schema = schema;

	static override is(value: unknown): value is BreathControlModule {
		return TransformModule.is(value) && value.type[2] === "breath-control";
	}

	override readonly type = ["async-module", "transform", "breath-control"] as const;
	override readonly bufferSize = Infinity;
	override readonly latency = Infinity;

	private controlSampleRate = 44100;

	protected override _setup(context: StreamContext): void {
		super._setup(context);
		this.controlSampleRate = context.sampleRate;
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channels = buffer.channels;
		const sampleRate = this.controlSampleRate;
		const { sensitivity, reduction, mode } = this.properties;

		const gainDb = mode === "remove" ? -96 : reduction;
		const gainLinear = Math.pow(10, gainDb / 20);

		const allAudio = await buffer.read(0, frames);
		const channel = allAudio.samples[0];

		if (!channel) return;

		// Step 1: Compute sample-level envelope trackers
		const envSmooth = Math.round(sampleRate * 0.01);
		const widebandEnv = new Float32Array(frames);
		const breathBandEnv = new Float32Array(frames);

		const lpCoeff = Math.exp((-2 * Math.PI * 1000) / sampleRate);
		const hpCoeff = Math.exp((-2 * Math.PI * 6000) / sampleRate);
		let lpState = 0;

		for (let index = 0; index < frames; index++) {
			const sample = channel[index] ?? 0;
			widebandEnv[index] = sample * sample;

			lpState = lpState * lpCoeff + sample * (1 - lpCoeff);
			const hp = sample - lpState;
			const bp = hp * (1 - hpCoeff);
			breathBandEnv[index] = bp * bp;
		}

		const smoothSource = new Float32Array(frames);
		smoothEnvelope(widebandEnv, envSmooth, smoothSource);
		smoothEnvelope(breathBandEnv, envSmooth, smoothSource);

		for (let index = 0; index < frames; index++) {
			widebandEnv[index] = Math.sqrt(widebandEnv[index] ?? 0);
			breathBandEnv[index] = Math.sqrt(breathBandEnv[index] ?? 0);
		}

		// Step 2: Sample-level breath detection
		const speechThreshold = 0.015 * (1 - sensitivity * 0.5);
		const breathThreshold = 0.002 * sensitivity;
		const isBreath = new Uint8Array(frames);

		for (let index = 0; index < frames; index++) {
			const isSpeechGap = (widebandEnv[index] ?? 0) < speechThreshold;
			const isBreathy = (breathBandEnv[index] ?? 0) > breathThreshold;
			isBreath[index] = isSpeechGap && isBreathy ? 1 : 0;
		}

		// Step 3: Find contiguous breath regions with minimum duration
		const minBreathDuration = Math.round(sampleRate * 0.08);
		const regions = findRegions(isBreath, minBreathDuration, frames);

		// Step 4: Extend each region to the true start/end of the breath
		const noiseFloor = speechThreshold * 0.3;

		for (const region of regions) {
			while (region.start > 0 && (widebandEnv[region.start - 1] ?? 0) < speechThreshold) {
				region.start--;
			}

			while (region.end < frames && (widebandEnv[region.end] ?? 0) < speechThreshold) {
				region.end++;
			}

			while (region.start < region.end && (widebandEnv[region.start] ?? 0) < noiseFloor) {
				region.start++;
			}

			while (region.end > region.start && (widebandEnv[region.end - 1] ?? 0) < noiseFloor) {
				region.end--;
			}
		}

		// Step 5: Build gain envelope with smooth crossfades
		const fadeLength = Math.round(sampleRate * 0.015);
		const gainEnvelope = new Float32Array(frames);
		gainEnvelope.fill(1);

		for (const region of regions) {
			for (let index = region.start; index < region.end; index++) {
				gainEnvelope[index] = gainLinear;
			}

			// Fade in at start
			for (let index = 0; index < fadeLength; index++) {
				const pos = region.start - fadeLength + index;

				if (pos >= 0 && pos < frames) {
					const fadeIn = (index + 1) / (fadeLength + 1);
					gainEnvelope[pos] = 1 + (gainLinear - 1) * fadeIn;
				}
			}

			// Fade out at end
			for (let index = 0; index < fadeLength; index++) {
				const pos = region.end + index;

				if (pos >= 0 && pos < frames) {
					const fadeOut = 1 - (index + 1) / (fadeLength + 1);
					gainEnvelope[pos] = 1 + (gainLinear - 1) * fadeOut;
				}
			}
		}

		// Step 6: Apply gain envelope to all channels
		for (let ch = 0; ch < channels; ch++) {
			const chData = allAudio.samples[ch];

			if (!chData) continue;

			for (let index = 0; index < frames; index++) {
				chData[index] = (chData[index] ?? 0) * (gainEnvelope[index] ?? 1);
			}
		}

		await buffer.truncate(0);
		await buffer.append(allAudio.samples);
	}

	clone(overrides?: Partial<BreathControlProperties>): BreathControlModule {
		return new BreathControlModule({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

interface Region {
	start: number;
	end: number;
}

function smoothEnvelope(envelope: Float32Array, windowSize: number, source: Float32Array): void {
	const halfWin = Math.floor(windowSize / 2);
	const len = envelope.length;
	source.set(envelope);

	let sum = 0;
	let count = 0;

	for (let index = 0; index < Math.min(halfWin, len); index++) {
		sum += source[index] ?? 0;
		count++;
	}

	for (let index = 0; index < len; index++) {
		const addIdx = index + halfWin;

		if (addIdx < len) {
			sum += source[addIdx] ?? 0;
			count++;
		}

		const removeIdx = index - halfWin - 1;

		if (removeIdx >= 0) {
			sum -= source[removeIdx] ?? 0;
			count--;
		}

		envelope[index] = sum / Math.max(count, 1);
	}
}

function findRegions(mask: Uint8Array, minDuration: number, length: number): Array<Region> {
	const regions: Array<Region> = [];
	let regionStart = -1;

	for (let index = 0; index <= length; index++) {
		const active = index < length && (mask[index] ?? 0) > 0;

		if (active && regionStart === -1) {
			regionStart = index;
		} else if (!active && regionStart !== -1) {
			if (index - regionStart >= minDuration) {
				regions.push({ start: regionStart, end: index });
			}

			regionStart = -1;
		}
	}

	return regions;
}

export function breathControl(options?: { sensitivity?: number; reduction?: number; mode?: "remove" | "attenuate"; id?: string }): BreathControlModule {
	return new BreathControlModule({
		sensitivity: options?.sensitivity ?? 0.5,
		reduction: options?.reduction ?? -12,
		mode: options?.mode ?? "attenuate",
		id: options?.id,
	});
}
