import { z } from "zod";
import {
	BufferedTransformStream,
	TransformNode,
	WHOLE_FILE,
	type AudioChunk,
	type BufferedAudioNodeInput,
	type ChunkBuffer,
	type StreamContext,
	type TransformNodeProperties,
} from "@e9g/buffered-audio-nodes-core";
import { initFftBackend, type FftBackend } from "@e9g/buffered-audio-nodes-utils";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../../package-metadata";
import { detectClicks, dilateMask, filterByDuration, windowIndexForSample } from "./utils/click-detection";
import { groupContiguousGaps, lsarInterpolate } from "./utils/lsar";

export const schema = z.object({
	sensitivity: z.number().min(0).max(1).multipleOf(0.01).default(0.5).describe("Sensitivity"),
	frequencySkew: z.number().min(-1).max(1).multipleOf(0.01).default(0).describe("Frequency Skew"),
	clickWidening: z.number().min(0).max(1).multipleOf(0.01).default(0.25).describe("Click Widening"),
	maxClickDuration: z.number().min(1).max(1000).multipleOf(1).default(200).describe("Max Click Duration (ms)"),
	fftSize: z.number().min(512).max(16384).multipleOf(256).default(2048).describe("FFT Size"),
	hopSize: z.number().min(128).max(4096).multipleOf(64).default(512).describe("Hop Size"),
	vkfftAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "vkfft-addon", download: "https://github.com/visionsofparadise/vkfft-addon" })
		.describe("VkFFT native addon — GPU FFT acceleration"),
	fftwAddonPath: z
		.string()
		.default("")
		.meta({ input: "file", mode: "open", binary: "fftw-addon", download: "https://github.com/visionsofparadise/fftw-addon" })
		.describe("FFTW native addon — CPU FFT acceleration"),
});

export interface DeClickProperties extends z.infer<typeof schema>, TransformNodeProperties {}

/**
 * Faithful G&R 1998 Ch 5–6 click detection + LSAR interpolation.
 *
 * Detection: short-window Burg AR (§5.2), per-sample Bayesian posterior test
 * against prior π derived from `sensitivity` (§5.3), STFT bin-group multiband
 * combination with per-band prior bias from `frequencySkew` (§5.7), and
 * periodic-click autocorrelation extension (§5.5).
 *
 * Repair: LSAR interpolation of gap samples using the same AR coefficients
 * that produced detection (§6.2) — not a low-pass duck. Spectrally consistent
 * reconstruction under the local AR model, with Cholesky-regularised normal
 * equations.
 *
 * @see Godsill, S. J. & Rayner, P. J. W. (1998). *Digital Audio Restoration:
 *   A Statistical Model-Based Approach*, Springer, Ch 5–6.
 */
export class DeClickStream extends BufferedTransformStream<DeClickProperties> {
	private fftBackend?: FftBackend;
	private fftAddonOptions?: { vkfftPath?: string; fftwPath?: string };

	override async _setup(input: ReadableStream<AudioChunk>, context: StreamContext): Promise<ReadableStream<AudioChunk>> {
		const fft = initFftBackend(context.executionProviders, this.properties);

		this.fftBackend = fft.backend;
		this.fftAddonOptions = fft.addonOptions;

		return super._setup(input, context);
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const frames = buffer.frames;
		const channels = buffer.channels;

		if (frames === 0) return;

		const sampleRate = this.sampleRate ?? 44100;
		const { sensitivity, frequencySkew, clickWidening, maxClickDuration, fftSize, hopSize } = this.properties;

		const allAudio = await buffer.read(0, frames);
		const refChannel = allAudio.samples[0];

		if (!refChannel) return;

		const detection = detectClicks(refChannel, sampleRate, {
			sensitivity,
			frequencySkew,
			fftSize,
			hopSize,
			fftBackend: this.fftBackend,
			fftAddonOptions: this.fftAddonOptions,
		});

		filterByDuration(detection.mask, Math.round((maxClickDuration / 1000) * sampleRate));

		const dilateHalfWidth = Math.round(clickWidening * 0.004 * sampleRate);
		const finalMask = dilateMask(detection.mask, dilateHalfWidth);

		let hasClicks = false;

		for (let index = 0; index < frames; index++) {
			if ((finalMask[index] ?? 0) > 0) {
				hasClicks = true;
				break;
			}
		}

		if (!hasClicks) return;

		// Group into contiguous gap regions; solve each with its local AR
		// coefficients. Far-apart regions share no Gram structure so running
		// them independently keeps each linear system small.
		const allGapIndices: Array<number> = [];

		for (let index = 0; index < frames; index++) {
			if ((finalMask[index] ?? 0) > 0) allGapIndices.push(index);
		}

		const gapGroups = groupContiguousGaps(allGapIndices);

		for (let ch = 0; ch < channels; ch++) {
			const channel = allAudio.samples[ch];

			if (!channel) continue;

			for (const group of gapGroups) {
				if (group.length === 0) continue;

				const centreSample = group[Math.floor(group.length / 2)] ?? 0;
				const windowIndex = windowIndexForSample(centreSample, detection.windowSize, detection.windowHop, detection.numWindows);
				const coeffs = detection.windowCoefficients[windowIndex];

				if (!coeffs || coeffs.length === 0) continue;

				lsarInterpolate(channel, group, coeffs);
			}
		}

		await buffer.truncate(0);
		await buffer.append(allAudio.samples);
	}
}

/**
 * Detects impulsive noise (clicks, pops) and reconstructs the affected
 * samples by LSAR interpolation under a short-window AR model. Per Godsill
 * & Rayner 1998 Ch 5–6 — one authoritative algorithm, no mode variants.
 */
export class DeClickNode<P extends DeClickProperties = DeClickProperties> extends TransformNode<P> {
	static override readonly moduleName: string = "De-Click";
	static override readonly packageName = PACKAGE_NAME;
	static override readonly packageVersion = PACKAGE_VERSION;
	static override readonly moduleDescription = "Remove clicks, pops, and impulse artifacts (Godsill & Rayner 1998)";
	static override readonly schema: z.ZodType = schema;

	static override is(value: unknown): value is DeClickNode {
		return TransformNode.is(value) && value.type[2] === "de-click";
	}

	override readonly type = ["buffered-audio-node", "transform", "de-click"];

	constructor(properties?: BufferedAudioNodeInput<P>) {
		const parsed = schema.parse(properties ?? {});

		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties, ...parsed } as BufferedAudioNodeInput<P>);
	}

	override createStream(): DeClickStream {
		return new DeClickStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<DeClickProperties>): DeClickNode {
		return new DeClickNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function deClick(options?: {
	sensitivity?: number;
	frequencySkew?: number;
	clickWidening?: number;
	maxClickDuration?: number;
	fftSize?: number;
	hopSize?: number;
	vkfftAddonPath?: string;
	fftwAddonPath?: string;
	id?: string;
}): DeClickNode {
	const parsed = schema.parse(options ?? {});

	return new DeClickNode({ ...parsed, id: options?.id });
}
