import { chain, ReadModule, WriteModule, WaveformTransformModule, SpectrogramModule, type AudioChainModule, type ChainModuleReference, type EncodingOptions, type FrequencyScale } from "audio-chain-module";
import type { ModuleRegistry } from "../../../../models/ModuleRegistry";
import type { ApplyInput } from "../Renderer";

function resolveModule(ref: ChainModuleReference, registry: ModuleRegistry): AudioChainModule {
	const packageModules = registry.get(ref.package);

	if (!packageModules) throw new Error(`Unknown package: "${ref.package}"`);

	const Module = packageModules.get(ref.module);

	if (!Module) throw new Error(`Unknown module: "${ref.module}" in package "${ref.package}"`);

	return new Module(ref.options);
}

export function buildChain(input: ApplyInput, registry: ModuleRegistry): AudioChainModule {
	const source = new ReadModule({ path: input.sourcePath, channels: input.sourceChannels ? [...input.sourceChannels] : undefined, ffmpegPath: "", ffprobePath: "" });

	const transforms: Array<AudioChainModule> = input.transforms.map((ref) => resolveModule(ref, registry));

	if (input.waveform) {
		transforms.push(new WaveformTransformModule({ outputPath: input.waveform.path, resolution: 1000 }));
	}

	if (input.spectrogram) {
		transforms.push(new SpectrogramModule({ outputPath: input.spectrogram.path, fftSize: 2048, hopSize: 512, frequencyScale: (input.spectrogram.frequencyScale ?? "log") as FrequencyScale }));
	}

	const encoding: EncodingOptions | undefined = input.encoding?.format === "wav" ? undefined : input.encoding;

	const target = new WriteModule({ path: input.targetPath, bitDepth: input.bitDepth ?? "16", encoding });

	return chain(source, ...transforms, target);
}
