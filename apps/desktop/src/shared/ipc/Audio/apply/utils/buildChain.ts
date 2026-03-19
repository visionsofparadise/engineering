import { ReadNode, WriteNode, WaveformNode, SpectrogramNode, type BufferedAudioNode, type ChainModuleReference, type EncodingOptions, type FrequencyScale } from "buffered-audio-nodes";
import type { ModuleRegistry } from "../../../../models/ModuleRegistry";
import type { ApplyInput } from "../Renderer";

function resolveModule(ref: ChainModuleReference, registry: ModuleRegistry): BufferedAudioNode {
	const packageModules = registry.get(ref.package);

	if (!packageModules) throw new Error(`Unknown package: "${ref.package}"`);

	const Module = packageModules.get(ref.module);

	if (!Module) throw new Error(`Unknown module: "${ref.module}" in package "${ref.package}"`);

	return new Module(ref.options);
}

export function buildChain(input: ApplyInput, registry: ModuleRegistry): BufferedAudioNode {
	const source = new ReadNode({ path: input.sourcePath, channels: input.sourceChannels ? [...input.sourceChannels] : undefined, ffmpegPath: "", ffprobePath: "" });

	const transforms: Array<BufferedAudioNode> = input.transforms.filter((ref) => !ref.bypass).map((ref) => resolveModule(ref, registry));

	if (input.waveform) {
		transforms.push(new WaveformNode({ outputPath: input.waveform.path, resolution: 500 }));
	}

	if (input.spectrogram) {
		transforms.push(new SpectrogramNode({ outputPath: input.spectrogram.path, fftSize: 4096, hopSize: 4096, frequencyScale: (input.spectrogram.frequencyScale ?? "log") as FrequencyScale }));
	}

	const encoding: EncodingOptions | undefined = input.encoding?.format === "wav" ? undefined : input.encoding;

	const target = new WriteNode({ path: input.targetPath, bitDepth: input.bitDepth ?? "16", encoding });

	let current: BufferedAudioNode = source;
	for (const transform of transforms) {
		current = current.to(transform);
	}
	current.to(target);
	return source;
}
