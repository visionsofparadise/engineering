type OptionalProperties<D extends object, K extends keyof D> = Omit<D, K> & Partial<Pick<D, K>>;

export interface AudioChunk {
	readonly samples: Array<Float32Array>;
	readonly offset: number;
	readonly duration: number;
}

export interface StreamContext {
	readonly sampleRate: number;
	readonly channels: number;
	readonly duration?: number;
}

export interface RenderOptions {
	readonly chunkSize?: number;
	readonly highWaterMark?: number;
}

export interface AudioChainModuleProperties {
	readonly id?: string;
	readonly targets: Array<AudioChainModule>;
	readonly previousProperties?: AudioChainModuleProperties;
}

export type AudioChainModuleInput<P extends AudioChainModuleProperties = AudioChainModuleProperties> = OptionalProperties<P, "targets">;

export abstract class AudioChainModule {
	static is(value: unknown): value is AudioChainModule {
		return typeof value === "object" && value !== null && "type" in value && Array.isArray(value.type) && value.type[0] === "async-module";
	}

	abstract readonly type: ReadonlyArray<string>;

	readonly properties: AudioChainModuleProperties;

	abstract readonly bufferSize: number;
	abstract readonly latency: number;

	constructor(properties?: AudioChainModuleInput) {
		this.properties = {
			...properties,
			targets: properties?.targets ?? [],
		};
	}

	get id(): string | undefined {
		return this.properties.id;
	}

	get targets(): Array<AudioChainModule> {
		return this.properties.targets;
	}

	abstract clone(overrides?: Partial<AudioChainModuleProperties>): AudioChainModule;

	to(target: AudioChainModule): void {
		this.properties.targets.push(target);
	}

	async setup(context: StreamContext): Promise<void> {
		await Promise.all([this._setup(context), ...this.targets.map((target) => target.setup(context))]);
	}

	protected _setup(_context: StreamContext): Promise<void> | void {
		return;
	}

	async teardown(): Promise<void> {
		await Promise.all(this.targets.map((target) => target.teardown()));

		await this._teardown();
	}

	protected _teardown(): Promise<void> | void {
		return;
	}
}
