import { createRequire } from "node:module";

export interface OnnxSession {
	run(inputs: Record<string, OnnxTensor>): Record<string, OnnxTensor>;
	dispose(): void;
}

export interface OnnxTensor {
	readonly data: Float32Array;
	readonly dims: ReadonlyArray<number>;
}

export interface OnnxSessionOptions {
	readonly executionProviders?: ReadonlyArray<string>;
}

interface OnnxAddon {
	createSession(modelPath: string, options?: { executionProviders?: Array<string> }): OnnxAddonSession;
}

interface OnnxAddonSession {
	run(inputs: Record<string, OnnxTensor>): Record<string, OnnxTensor>;
	dispose(): void;
	inputNames(): Array<string>;
	outputNames(): Array<string>;
}

const require = createRequire(import.meta.url);

export function createOnnxSession(addonPath: string, modelPath: string, options?: OnnxSessionOptions): OnnxSession {
	const addon = require(addonPath) as OnnxAddon;

	const session = addon.createSession(modelPath, {
		executionProviders: options?.executionProviders ? [...options.executionProviders] : ["cuda", "cpu"],
	});

	return {
		run(inputs) {
			return session.run(inputs);
		},
		dispose() {
			session.dispose();
		},
	};
}
