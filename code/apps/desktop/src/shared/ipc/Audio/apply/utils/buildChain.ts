import { chain, type AudioChainModule, type ChainModuleReference, type EncodingOptions } from "@engineering/acm";
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
	const source = resolveModule({ package: "acm", module: "Read", options: { path: input.sourcePath, channels: input.sourceChannels ? [...input.sourceChannels] : undefined } }, registry);

	const transforms: Array<AudioChainModule> = input.transforms.map((ref) => resolveModule(ref, registry));

	const encoding: EncodingOptions | undefined = input.encoding?.format === "wav" ? undefined : input.encoding;

	const target = resolveModule({ package: "acm", module: "Write", options: { path: input.targetPath, bitDepth: input.bitDepth, encoding } }, registry);

	return chain(source, ...transforms, target);
}
