import { Transient } from "../Transient";
import type { State } from ".";

export interface PlaybackState extends State {
	readonly currentMs: Transient<number>;
	readonly isPlaying: boolean;
	readonly volume: number;
	readonly playbackRate: number;
	readonly isLooping: boolean;
}

export function createPlaybackState(): Omit<PlaybackState, "_key"> {
	return {
		currentMs: new Transient(0, { default: 0, minimum: 0 }),
		isPlaying: false,
		volume: 1,
		playbackRate: 1,
		isLooping: false,
	};
}
