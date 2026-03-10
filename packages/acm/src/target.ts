import { AudioChainModule, type AudioChainModuleProperties, type AudioChunk } from "./module";

export interface TargetModuleProperties extends AudioChainModuleProperties {}

export abstract class TargetModule<P extends TargetModuleProperties = TargetModuleProperties> extends AudioChainModule<P> {
	static override is(value: unknown): value is TargetModule {
		return AudioChainModule.is(value) && value.type[1] === "target";
	}

	private hasStarted = false;
	private framesWritten = 0;

	abstract _write(chunk: AudioChunk): Promise<void>;
	abstract _close(): Promise<void>;

	createWritable(): WritableStream<AudioChunk> {
		this.hasStarted = false;
		this.framesWritten = 0;

		return new WritableStream<AudioChunk>({
			write: async (chunk) => {
				if (!this.hasStarted) {
					this.hasStarted = true;
					this.emit("started");
				}

				await this._write(chunk);

				this.framesWritten += chunk.duration;

				this.emit("progress", { framesProcessed: this.framesWritten, sourceTotalFrames: this.sourceTotalFrames });
			},
			close: async () => {
				await this._close();

				this.emit("finished");
			},
		});
	}
}
