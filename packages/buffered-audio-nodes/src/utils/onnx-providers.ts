import type { ExecutionProvider } from "@e9g/buffered-audio-nodes-core";

export function filterOnnxProviders(providers: ReadonlyArray<ExecutionProvider>): Array<string> {
	const out: Array<string> = [];

	for (const ep of providers) {
		if (ep === "gpu") out.push("cuda");
		else if (ep === "cpu") out.push("cpu");
	}

	return out.length > 0 ? out : ["cpu"];
}
