import { useCallback, useRef } from "react";
import type { SessionContext } from "../../../../models/Context";
import { clampPixelsPerSecond, msToPixels, pixelsToMs } from "../../../../utils/time";

const ZOOM_FACTOR = 1.1;

export function useWorkspaceWheel(durationMs: number, context: SessionContext): (event: React.WheelEvent) => void {
	const { workspace, sessionStore } = context;
	const durationRef = useRef(durationMs);

	durationRef.current = durationMs;

	return useCallback(
		(event: React.WheelEvent) => {
			event.preventDefault();
			const duration = durationRef.current;

			if (event.ctrlKey || event.metaKey) {
				const pps = workspace.pixelsPerSecond.value;
				const viewportWidth = workspace.viewportWidth.value;
				const cursorX = event.nativeEvent.offsetX;
				const cursorMs = pixelsToMs(workspace.scrollX.value + cursorX, pps);

				const factor = event.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
				const newPps = clampPixelsPerSecond(pps * factor, viewportWidth, duration);

				const newCursorPx = msToPixels(cursorMs, newPps);
				const newScrollX = Math.max(0, newCursorPx - cursorX);

				sessionStore.mutate(workspace, (proxy) => {
					proxy.pixelsPerSecond.committed.value = newPps;
					proxy.scrollX.committed.value = newScrollX;
				});
			} else {
				const pps = workspace.pixelsPerSecond.value;
				const maxScroll = Math.max(0, msToPixels(duration, pps) - workspace.viewportWidth.value);
				const newScrollX = Math.max(0, Math.min(maxScroll, workspace.scrollX.value + event.deltaX + event.deltaY));

				sessionStore.mutate(workspace, (proxy) => {
					proxy.scrollX.committed.value = newScrollX;
				});
			}
		},
		[workspace, sessionStore],
	);
}
