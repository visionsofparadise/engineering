import type { Snapshot } from "valtio/vanilla";
import type { State } from ".";
import { sampleFrameToMs } from "../../utils/time";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";
import { Transient } from "../Transient";

export interface SelectionState extends State {
	readonly startFrame: Transient<number>;
	readonly endFrame: Transient<number>;
	readonly channels: ReadonlyArray<number>;
	readonly active: boolean;
}

export function useSelectionState(store: ProxyStore): Snapshot<SelectionState> {
	return useCreateState<SelectionState>(
		{
			startFrame: new Transient(0, { minimum: 0 }),
			endFrame: new Transient(0, { minimum: 0 }),
			channels: [],
			active: false,
		},
		store,
	);
}

export function selectionDurationMs(selection: Snapshot<SelectionState>, sampleRate: number): number {
	const startMs = sampleFrameToMs(selection.startFrame.committed.value, sampleRate);
	const endMs = sampleFrameToMs(selection.endFrame.committed.value, sampleRate);

	return Math.abs(endMs - startMs);
}

export function selectionContainsChannel(selection: Snapshot<SelectionState>, channelIndex: number): boolean {
	return selection.channels.includes(channelIndex);
}

export function selectionToMs(
	selection: Snapshot<SelectionState>,
	sampleRate: number,
): { readonly startMs: number; readonly endMs: number } {
	const rawStart = sampleFrameToMs(selection.startFrame.committed.value, sampleRate);
	const rawEnd = sampleFrameToMs(selection.endFrame.committed.value, sampleRate);

	return {
		startMs: Math.min(rawStart, rawEnd),
		endMs: Math.max(rawStart, rawEnd),
	};
}
