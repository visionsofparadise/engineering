import { Transient } from "../Transient";
import type { State } from ".";

export interface SelectionState extends State {
	readonly startFrame: Transient<number>;
	readonly endFrame: Transient<number>;
	readonly channels: Array<number>;
	readonly active: boolean;
}

export function createSelectionState(): Omit<SelectionState, "_key"> {
	return {
		startFrame: new Transient(0, { default: 0, minimum: 0 }),
		endFrame: new Transient(0, { default: 0, minimum: 0 }),
		channels: [],
		active: false,
	};
}
