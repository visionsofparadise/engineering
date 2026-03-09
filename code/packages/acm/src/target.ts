import { AudioChainModule, type AudioChainModuleInput, type AudioChainModuleProperties, type AudioChunk } from "./module";

export interface TargetModuleProperties extends AudioChainModuleProperties {}

export abstract class TargetModule extends AudioChainModule {
	static override is(value: unknown): value is TargetModule {
		return AudioChainModule.is(value) && value.type[1] === "target";
	}

	readonly properties: TargetModuleProperties;

	constructor(properties?: AudioChainModuleInput<TargetModuleProperties>) {
		super(properties);

		this.properties = {
			...properties,
			targets: properties?.targets ?? [],
		};
	}

	abstract _write(chunk: AudioChunk): Promise<void>;
	abstract _close(): Promise<void>;

	createWritable(): WritableStream<AudioChunk> {
		return new WritableStream<AudioChunk>({
			write: (chunk) => this._write(chunk),
			close: () => this._close(),
		});
	}
}
