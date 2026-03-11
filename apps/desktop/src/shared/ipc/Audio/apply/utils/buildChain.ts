import { chain, read, write, type AudioChainModule, type ChainModuleReference, type EncodingOptions } from "@engineering/acm";
import type { ModuleRegistry } from "../../../../models/ModuleRegistry";
import type { ApplyInput } from "../Renderer";

function resolveTransform(ref: ChainModuleReference, registry: ModuleRegistry): AudioChainModule {
	const packageModules = registry.get(ref.package);
	if (!packageModules) throw new Error(`Unknown package: "${ref.package}"`);
	const Module = packageModules.get(ref.module);
	if (!Module) throw new Error(`Unknown module: "${ref.module}" in package "${ref.package}"`);
	return new Module(ref.options);
}

export function buildChain(input: ApplyInput, registry: ModuleRegistry): AudioChainModule {
	const source = read(input.sourcePath, {
		channels: input.sourceChannels ? [...input.sourceChannels] : undefined,
	});

	const transforms: Array<AudioChainModule> = input.transforms.map((ref) => resolveTransform(ref, registry));

	const encoding: EncodingOptions | undefined = input.encoding?.format === "wav" ? undefined : input.encoding;

	const target = write(input.targetPath, { bitDepth: input.bitDepth, encoding });

	return chain(source, ...transforms, target);
}
