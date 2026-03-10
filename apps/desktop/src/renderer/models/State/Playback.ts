import type { Snapshot } from "valtio/vanilla";
import type { State } from ".";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";
import { Transient } from "../Transient";

export interface PlaybackState extends State {
	readonly currentMs: Transient<number>;
	readonly isPlaying: boolean;
	readonly volume: number;
	readonly playbackRate: number;
	readonly isLooping: boolean;
}

export function usePlaybackState(store: ProxyStore): Snapshot<PlaybackState> {
	return useCreateState<PlaybackState>(
		{
			currentMs: new Transient(0, { minimum: 0 }),
			isPlaying: false,
			volume: 1,
			playbackRate: 1,
			isLooping: false,
		},
		store,
	);
}
