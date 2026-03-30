export interface WindowBounds {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

export interface MainEventMap {
	windowBoundsChanged: [windowBounds: WindowBounds];
}

export interface RendererEventMap {}
