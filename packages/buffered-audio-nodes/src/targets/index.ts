import { EventEmitter } from "node:events";
import { BufferedAudioNode, type AudioChunk, type BufferedAudioNodeProperties, type StreamContext } from "../node";

export interface TargetNodeProperties extends BufferedAudioNodeProperties {}

export interface TargetStreamEventMap {
	started: [];
	finished: [];
	progress: [{ framesProcessed: number; sourceTotalFrames?: number }];
}

export abstract class BufferedTargetStream<P extends TargetNodeProperties = TargetNodeProperties> {
	readonly properties: P;
	readonly context: StreamContext;
	readonly events = new EventEmitter<TargetStreamEventMap>();

	private hasStarted = false;
	private framesWritten = 0;
	private readonly sourceTotalFrames?: number;

	constructor(properties: P, context: StreamContext) {
		this.properties = properties;
		this.context = context;
		this.sourceTotalFrames = context.durationFrames;
	}

	abstract _write(chunk: AudioChunk): Promise<void>;
	abstract _close(): Promise<void>;

	_teardown(): Promise<void> | void {
		return;
	}

	createWritableStream(): WritableStream<AudioChunk> {
		this.hasStarted = false;
		this.framesWritten = 0;

		return new WritableStream<AudioChunk>({
			write: async (chunk) => {
				if (!this.hasStarted) {
					this.hasStarted = true;
					this.events.emit("started");
				}

				await this._write(chunk);

				this.framesWritten += chunk.samples[0]?.length ?? 0;

				this.events.emit("progress", { framesProcessed: this.framesWritten, sourceTotalFrames: this.sourceTotalFrames });
			},
			close: async () => {
				await this._close();

				this.events.emit("finished");
			},
		});
	}
}

export abstract class TargetNode<P extends TargetNodeProperties = TargetNodeProperties> extends BufferedAudioNode<P> {
	static override is(value: unknown): value is TargetNode {
		return BufferedAudioNode.is(value) && value.type[1] === "target";
	}

	abstract createStream(context: StreamContext): BufferedTargetStream<P>;
}
