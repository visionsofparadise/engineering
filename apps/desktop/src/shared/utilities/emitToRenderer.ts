export interface WindowState {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly maximized: boolean;
}

export interface AudioProgressEvent {
	readonly jobId: string;
	readonly moduleIndex: number;
	readonly moduleName: string;
	readonly framesProcessed: number;
	readonly sourceTotalFrames?: number;
}

export interface AudioChainCompleteEvent {
	readonly jobId: string;
	readonly status: "completed" | "aborted";
	readonly completedModules: number;
	readonly targetPath?: string;
}

export interface AudioModuleCompleteEvent {
	readonly jobId: string;
	readonly moduleIndex: number;
	readonly moduleName: string;
	readonly snapshotPath: string;
}

export interface MainEventMap {
	windowBoundsChanged: [windowState: WindowState];
	"audio:progress": [event: AudioProgressEvent];
	"audio:chainComplete": [event: AudioChainCompleteEvent];
	"audio:moduleComplete": [event: AudioModuleCompleteEvent];
}

export interface RendererEventMap {}
