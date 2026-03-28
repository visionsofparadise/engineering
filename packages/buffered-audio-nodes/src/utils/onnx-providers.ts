import type { ExecutionProvider } from "@e9g/buffered-audio-nodes-core";

export function filterOnnxProviders(providers: ReadonlyArray<ExecutionProvider>): ReadonlyArray<ExecutionProvider> {
	const filtered = providers.filter((ep) => ep !== "gpu" && ep !== "cpu-native");

	return filtered.length > 0 ? filtered : ["cpu"];
}
