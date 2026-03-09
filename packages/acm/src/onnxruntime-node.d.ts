declare module "onnxruntime-node" {
	export const InferenceSession: {
		create(path: string): Promise<{
			run(inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
			release(): Promise<void>;
		}>;
	};

	export const Tensor: new (type: string, data: Float32Array, dims: Array<number>) => unknown;
}
