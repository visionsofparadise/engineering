export interface WindowState {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly maximized: boolean;
}

export interface MainEventMap {
	windowBoundsChanged: [windowState: WindowState];
}

export interface RendererEventMap {}
