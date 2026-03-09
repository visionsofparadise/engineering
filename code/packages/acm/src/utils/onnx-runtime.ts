export interface OnnxSession {
	run(inputs: Record<string, OnnxTensor>): Promise<Record<string, OnnxTensor>>;
	dispose(): void;
}

export interface OnnxTensor {
	readonly data: Float32Array;
	readonly dims: ReadonlyArray<number>;
}

export async function createOnnxSession(modelPath: string): Promise<OnnxSession> {
	let ort: OrtModule;

	try {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- dynamic import of optional peer dependency
		ort = await import("onnxruntime-node");
	} catch {
		throw new Error(
			`onnxruntime-node is required for ML-based units. Install it as a dependency: npm install onnxruntime-node`,
		);
	}

	const session = await ort.InferenceSession.create(modelPath);

	return {
		async run(inputs) {
			const ortInputs: Record<string, unknown> = {};

			for (const [name, tensor] of Object.entries(inputs)) {
				ortInputs[name] = new ort.Tensor("float32", tensor.data, [...tensor.dims]);
			}

			const results = await session.run(ortInputs);
			const output: Record<string, OnnxTensor> = {};

			for (const [name, tensor] of Object.entries(results)) {
				const ortTensor = tensor as { data: Float32Array; dims: ReadonlyArray<number> };

				output[name] = {
					data: Float32Array.from(ortTensor.data),
					dims: [...ortTensor.dims],
				};
			}

			return output;
		},
		dispose() {
			void session.release();
		},
	};
}

interface OrtModule {
	InferenceSession: {
		create(path: string): Promise<{
			run(inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
			release(): Promise<void>;
		}>;
	};
	Tensor: new (type: string, data: Float32Array, dims: Array<number>) => unknown;
}
