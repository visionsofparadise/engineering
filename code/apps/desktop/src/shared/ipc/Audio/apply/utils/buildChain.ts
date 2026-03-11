import {
	breathControl,
	chain,
	deClick,
	deClip,
	dePlosive,
	deReverb,
	dither,
	leveler,
	loudness,
	normalize,
	phase,
	pitchShift,
	read,
	resample,
	reverse,
	spectrogram,
	timeStretch,
	trim,
	waveform,
	write,
	type AudioChainModule,
	type ChainModuleReference,
	type EncodingOptions,
	type FrequencyScale,
} from "@engineering/acm";
import type { ApplyInput } from "../Renderer";

export function resolveTransform(ref: ChainModuleReference): AudioChainModule {
	switch (ref.module) {
		case "normalize":
			return normalize(ref.options);
		case "de-click":
			return deClick(ref.options);
		case "de-clip":
			return deClip(ref.options);
		case "de-reverb":
			return deReverb(ref.options);
		case "de-plosive":
			return dePlosive(ref.options);
		case "breath-control":
			return breathControl(ref.options);
		case "dither":
			return dither((Number(ref.options?.bitDepth) || 16) as 16 | 24, ref.options);
		case "leveler":
			return leveler(ref.options);
		case "loudness":
			return loudness(ref.options);
		case "trim":
			return trim(ref.options);
		case "reverse":
			return reverse();
		case "resample":
			return resample(Number(ref.options?.sampleRate) || 44100, ref.options);
		case "phase":
			return phase(ref.options);
		case "time-stretch":
			return timeStretch(Number(ref.options?.rate) || 1, ref.options);
		case "pitch-shift":
			return pitchShift(Number(ref.options?.semitones) || 0, ref.options);
		case "waveform":
			return waveform(String(ref.options?.path));
		case "spectrogram":
			return spectrogram(String(ref.options?.path), { frequencyScale: ref.options?.frequencyScale as FrequencyScale });
		default:
			throw new Error(`Unknown module: "${ref.module}" from package "${ref.package}"`);
	}
}

export function buildChain(input: ApplyInput): AudioChainModule {
	const source = read(input.sourcePath, {
		channels: input.sourceChannels ? [...input.sourceChannels] : undefined,
	});

	const transforms: Array<AudioChainModule> = input.transforms.map(resolveTransform);

	const encoding: EncodingOptions | undefined = input.encoding?.format === "wav" ? undefined : input.encoding;

	const target = write(input.targetPath, { bitDepth: input.bitDepth, encoding });

	return chain(source, ...transforms, target);
}
