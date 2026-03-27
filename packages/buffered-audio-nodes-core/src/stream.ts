import { EventEmitter } from "node:events";
import type { BufferedAudioNodeProperties } from "./node";

export interface StreamEventMap {
	started: [];
	finished: [];
	progress: [{ framesProcessed: number; sourceTotalFrames?: number }];
}

export abstract class BufferedStream<P extends BufferedAudioNodeProperties = BufferedAudioNodeProperties> {
	readonly properties: P;
	readonly events = new EventEmitter<StreamEventMap>();

	constructor(properties: P) {
		this.properties = properties;
	}

	_teardown(): Promise<void> | void {
		return;
	}
}
