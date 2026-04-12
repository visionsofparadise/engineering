import { type RefObject, useMemo } from "react";
import { useDrag } from "@use-gesture/react";
import type { SnapshotContext } from "../models/Context";
import type { Mutable } from "../models/State";
import type { SnapshotState } from "../models/State/Snapshot";
import type { SelectionState } from "../models/State/Selection";

const DRAG_THRESHOLD_PX = 5;

export function useSelectionInteraction(
	containerRef: RefObject<HTMLDivElement | null>,
	context: SnapshotContext,
): void {
	const { snapshot, snapshotStore, selection, wavFile, playbackEngine } = context;

	const snapshotProxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<Mutable<SnapshotState>>(snapshot._key),
		[snapshotStore, snapshot._key],
	);

	const selectionProxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<Mutable<SelectionState>>(selection._key),
		[snapshotStore, selection._key],
	);

	useDrag(
		({ first, last, xy: [clientX], initial: [initialClientX], movement: [movementX] }) => {
			if (!snapshotProxy || !selectionProxy) return;

			const rect = containerRef.current?.getBoundingClientRect();

			if (!rect) return;

			const pixelX = clientX - rect.left;
			const initialPixelX = initialClientX - rect.left;

			const isDrag = Math.abs(movementX) > DRAG_THRESHOLD_PX;

			if (first) {
				// On drag start: set selection active, write startFrame
				const frame = pixelToFrame(initialPixelX, snapshotProxy, wavFile.sampleRate);

				selectionProxy.active = true;
				selectionProxy.startFrame.transient.value = frame;
				selectionProxy.endFrame.transient.value = frame;
			} else if (!last) {
				// During drag: update endFrame transiently
				if (isDrag) {
					const frame = pixelToFrame(pixelX, snapshotProxy, wavFile.sampleRate);

					selectionProxy.endFrame.transient.value = frame;
				}
			} else {
				// On drag end
				if (!isDrag) {
					// Click-to-seek: no significant drag distance
					selectionProxy.active = false;

					const seekMs = pixelToMs(initialPixelX, snapshotProxy);

					playbackEngine.seek(seekMs);
				} else {
					// Commit selection
					const startFrame = pixelToFrame(initialPixelX, snapshotProxy, wavFile.sampleRate);
					const endFrame = pixelToFrame(pixelX, snapshotProxy, wavFile.sampleRate);

					// Ensure startFrame <= endFrame
					const lo = Math.min(startFrame, endFrame);
					const hi = Math.max(startFrame, endFrame);

					selectionProxy.startFrame.committed.value = lo;
					selectionProxy.endFrame.committed.value = hi;
					selectionProxy.active = true;
				}
			}
		},
		{
			target: containerRef,
			threshold: 0,
			filterTaps: false,
		},
	);
}

function pixelToFrame(pixelX: number, proxy: Mutable<SnapshotState>, sampleRate: number): number {
	const scrollX = proxy.scrollX.value;
	const pps = proxy.pixelsPerSecond.value;
	const seconds = (scrollX + pixelX) / pps;

	return Math.max(0, Math.round(seconds * sampleRate));
}

function pixelToMs(pixelX: number, proxy: Mutable<SnapshotState>): number {
	const scrollX = proxy.scrollX.value;
	const pps = proxy.pixelsPerSecond.value;

	return ((scrollX + pixelX) / pps) * 1000;
}
