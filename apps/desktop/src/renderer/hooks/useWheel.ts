import { type RefObject, useMemo } from "react";
import { useGesture } from "@use-gesture/react";
import type { SnapshotContext } from "../models/Context";
import type { Mutable } from "../models/State";
import type { SnapshotState } from "../models/State/Snapshot";

const SCROLL_SPEED = 0.5;
const ZOOM_SPEED = 0.005;

export function useWheel(containerRef: RefObject<HTMLDivElement | null>, context: SnapshotContext): void {
	const { snapshot, snapshotStore } = context;

	const proxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<Mutable<SnapshotState>>(snapshot._key),
		[snapshotStore, snapshot._key],
	);

	useGesture(
		{
			onWheel: ({ event, delta: [, deltaY] }) => {
				if (!proxy) return;

				event.preventDefault();

				if (event.ctrlKey) {
					// Zoom: Ctrl + wheel changes pixelsPerSecond, centered on cursor
					const rect = containerRef.current?.getBoundingClientRect();

					if (!rect) return;

					const cursorOffsetX = event.clientX - rect.left;
					const currentPps = proxy.pixelsPerSecond.value;
					const currentScrollX = proxy.scrollX.value;

					// Time position under cursor before zoom
					const timeUnderCursor = (currentScrollX + cursorOffsetX) / currentPps;

					// Apply zoom factor
					const zoomFactor = 1 - deltaY * ZOOM_SPEED;
					const newPps = currentPps * zoomFactor;

					// Adjust scrollX so the time under cursor stays at the same pixel position
					const newScrollX = timeUnderCursor * newPps - cursorOffsetX;

					proxy.pixelsPerSecond.transient.value = newPps;
					proxy.scrollX.transient.value = Math.max(0, newScrollX);
				} else {
					// Scroll: normal wheel maps deltaY to horizontal scroll
					const currentPps = proxy.pixelsPerSecond.value;
					const scrollAmount = deltaY * SCROLL_SPEED * (100 / currentPps);

					proxy.scrollX.transient.value = Math.max(0, proxy.scrollX.value + scrollAmount);
				}
			},
		},
		{
			target: containerRef,
			wheel: { eventOptions: { passive: false } },
		},
	);
}
