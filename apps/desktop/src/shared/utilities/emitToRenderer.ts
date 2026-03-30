export interface WindowBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface FileChangedPayload {
	path: string;
	contentHash: string;
}

export interface AudioProgressPayload {
	jobId: string;
	framesProcessed: number;
	sourceTotalFrames: number;
}

export interface AudioChainCompletePayload {
	jobId: string;
	status: "completed" | "failed" | "aborted";
	snapshotPaths?: Record<string, string>;
}

export interface MainEventMap {
	windowBoundsChanged: [windowBounds: WindowBounds];
	"file:changed": [payload: FileChangedPayload];
	"audio:progress": [payload: AudioProgressPayload];
	"audio:chainComplete": [payload: AudioChainCompletePayload];
}

export interface RendererEventMap {}
