import { Transient } from "../Transient";
import type { State } from ".";

export interface SnapshotState extends State {
	readonly snapshotHash: string;
	readonly pixelsPerSecond: Transient<number>;
	readonly scrollX: Transient<number>;
	readonly viewportWidth: Transient<number>;
	readonly viewportHeight: Transient<number>;
	readonly cursorX: Transient<number>;
	readonly cursorMode: "time" | "frequency" | "lasso" | "brush" | "pan" | "zoom";
	readonly spectrogramAlgorithm: "log" | "mel" | "ERB" | "linear";
	readonly fftSize: number;
	readonly hopOverlap: number;
	readonly dbRange: number;
}

export function createSnapshotState(snapshotHash: string): Omit<SnapshotState, "_key"> {
	return {
		snapshotHash,
		pixelsPerSecond: new Transient(100, { default: 100, minimum: 1, maximum: 10000 }),
		scrollX: new Transient(0, { default: 0, minimum: 0 }),
		viewportWidth: new Transient(0, { default: 0 }),
		viewportHeight: new Transient(0, { default: 0 }),
		cursorX: new Transient(-1, { default: -1 }),
		cursorMode: "time",
		spectrogramAlgorithm: "log",
		fftSize: 4096,
		hopOverlap: 4,
		dbRange: 90,
	};
}
