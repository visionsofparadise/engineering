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
} from "@engineering/acm";
import path from "node:path";
import type { ApplyChainInput } from "../../shared/ipc/Audio/applyChain/Renderer";

function resolveTransform(ref: ChainModuleReference): AudioChainModule {
	switch (ref.module) {
		case "normalize": return normalize(ref.options);
		case "de-click": return deClick(ref.options);
		case "de-clip": return deClip(ref.options);
		case "de-reverb": return deReverb(ref.options);
		case "de-plosive": return dePlosive(ref.options);
		case "breath-control": return breathControl(ref.options);
		case "dither": return dither((Number(ref.options?.bitDepth) || 16) as 16 | 24, ref.options);
		case "leveler": return leveler(ref.options);
		case "loudness": return loudness(ref.options);
		case "trim": return trim(ref.options);
		case "reverse": return reverse();
		case "resample": return resample(Number(ref.options?.sampleRate) || 44100, ref.options);
		case "phase": return phase(ref.options);
		case "time-stretch": return timeStretch(Number(ref.options?.rate) || 1, ref.options);
		case "pitch-shift": return pitchShift(Number(ref.options?.semitones) || 0, ref.options);
		default: throw new Error(`Unknown module: "${ref.module}" from package "${ref.package}"`);
	}
}

export function buildChain(input: ApplyChainInput): AudioChainModule {
	const source = read(input.sourcePath, {
		channels: input.sourceChannels ? [...input.sourceChannels] : undefined,
	});

	const transforms: Array<AudioChainModule> = input.transforms.map(resolveTransform);

	const waveformPath = path.join(input.targetPath, "waveform.bin");
	const spectrogramPath = path.join(input.targetPath, "spectrogram.bin");
	const audioPath = path.join(input.targetPath, "audio.wav");

	transforms.push(waveform(waveformPath));
	transforms.push(spectrogram(spectrogramPath, { frequencyScale: "log" }));

	const target = write(audioPath);

	return chain(source, ...transforms, target);
}
