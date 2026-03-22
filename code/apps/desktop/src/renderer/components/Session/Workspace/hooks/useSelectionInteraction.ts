import { useCallback, useRef } from "react";
import type { SessionContext } from "../../../../models/Context";
import { msToSampleFrame, pixelsToMs } from "../../../../utils/time";
import { useMonitoredSnapshotPath } from "../../hooks/useMonitoredSnapshotPath";
import { useWaveformHeader } from "./useWaveformHeader";

function channelFromY(localY: number, laneHeight: number, channelCount: number): number {
	if (laneHeight <= 0) return 0;
	const index = Math.floor(localY / laneHeight);

	return Math.max(0, Math.min(channelCount - 1, index));
}

function contiguousChannels(from: number, to: number): Array<number> {
	const lo = Math.min(from, to);
	const hi = Math.max(from, to);
	const result: Array<number> = [];

	for (let ch = lo; ch <= hi; ch++) {
		result.push(ch);
	}

	return result;
}

interface SelectionHandlers {
	readonly onPointerDown: (event: React.PointerEvent) => void;
	readonly onPointerMove: (event: React.PointerEvent) => void;
	readonly onPointerUp: (event: React.PointerEvent) => void;
}

export function useSelectionInteraction(context: SessionContext): SelectionHandlers {
	const { workspace, selection, sessionStore } = context;
	const activeSnapshotPath = useMonitoredSnapshotPath(context);
	const waveformHeader = useWaveformHeader(activeSnapshotPath);
	const sampleRate = waveformHeader?.sampleRate ?? 44100;
	const channelCount = waveformHeader?.channels ?? 0;

	const startChannelRef = useRef(0);
	const draggingRef = useRef(false);
	const startPosRef = useRef<{ x: number; y: number } | undefined>(undefined);

	const pixelToFrame = useCallback(
		(localX: number): number => {
			const ms = pixelsToMs(localX + workspace.scrollX.value, workspace.pixelsPerSecond.value);

			return msToSampleFrame(Math.max(0, ms), sampleRate);
		},
		[workspace.scrollX, workspace.pixelsPerSecond, sampleRate],
	);

	const onPointerDown = useCallback(
		(event: React.PointerEvent) => {
			if (event.button !== 0) return;
			const target = event.currentTarget;

			target.setPointerCapture(event.pointerId);

			const rect = target.getBoundingClientRect();
			const localX = event.clientX - rect.left;
			const localY = event.clientY - rect.top;

			startPosRef.current = { x: localX, y: localY };
			draggingRef.current = false;

			const frame = pixelToFrame(localX);
			const laneHeight = workspace.viewportHeight.value / channelCount;
			const channel = channelFromY(localY, laneHeight, channelCount);

			startChannelRef.current = channel;

			sessionStore.mutate(selection, (proxy) => {
				proxy.startFrame.committed.value = frame;
				proxy.endFrame.committed.value = frame;
				proxy.channels = [channel];
				proxy.active = true;
			});
		},
		[pixelToFrame, channelCount, selection, sessionStore],
	);

	const onPointerMove = useCallback(
		(event: React.PointerEvent) => {
			if (!startPosRef.current) return;
			if (!selection.active) return;

			const target = event.currentTarget;
			const rect = target.getBoundingClientRect();
			const localX = event.clientX - rect.left;
			const localY = event.clientY - rect.top;

			const dx = localX - startPosRef.current.x;
			const dy = localY - startPosRef.current.y;

			if (!draggingRef.current && Math.abs(dx) + Math.abs(dy) > 3) {
				draggingRef.current = true;
			}

			if (!draggingRef.current) return;

			const laneHeight = workspace.viewportHeight.value / channelCount;
			const currentChannel = channelFromY(localY, laneHeight, channelCount);

			sessionStore.mutate(selection, (proxy) => {
				proxy.endFrame.transient.value = pixelToFrame(localX);
				proxy.channels = contiguousChannels(startChannelRef.current, currentChannel);
			});
		},
		[selection, pixelToFrame, channelCount, sessionStore],
	);

	const onPointerUp = useCallback(
		(event: React.PointerEvent) => {
			const target = event.currentTarget;

			target.releasePointerCapture(event.pointerId);

			if (!draggingRef.current) {
				sessionStore.mutate(selection, (proxy) => {
					proxy.active = false;
				});

				if (startPosRef.current) {
					const rect = target.getBoundingClientRect();
					const localX = event.clientX - rect.left;
					const ms = pixelsToMs(localX + workspace.scrollX.value, workspace.pixelsPerSecond.value);

					context.playbackEngine.seek(Math.max(0, ms));
				}
			} else if (selection.active) {
				const committedEnd = selection.endFrame.value;
				const startVal = selection.startFrame.committed.value;

				sessionStore.mutate(selection, (proxy) => {
					proxy.endFrame.committed.value = committedEnd;
					if (startVal > committedEnd) {
						proxy.startFrame.committed.value = committedEnd;
						proxy.endFrame.committed.value = startVal;
					}
				});
			}

			startPosRef.current = undefined;
			draggingRef.current = false;
		},
		[context, selection, sessionStore, workspace.scrollX, workspace.pixelsPerSecond],
	);

	return { onPointerDown, onPointerMove, onPointerUp };
}
