import { useCallback, useEffect, useMemo, useRef } from "react";
import type { SessionContext, WorkspaceContext } from "../../../models/Context";
import { resnapshot } from "../../../models/ProxyStore/resnapshot";
import { clampPixelsPerSecond, getMinPixelsPerSecond, msToPixels } from "../../../utils/time";
import { useActiveSnapshotPath } from "../hooks/useActiveSnapshotPath";
import { AMPLITUDE_AXIS_WIDTH, AmplitudeAxis } from "./Channel/AmplitudeAxis";
import { CursorIndicator } from "./Channel/CursorIndicator";
import { FREQUENCY_AXIS_WIDTH, FrequencyAxis } from "./Channel/FrequencyAxis";
import { ChannelLane } from "./Channel/Lane";
import { Playhead } from "./Channel/Playhead";
import { SelectionOverlay } from "./Channel/SelectionOverlay";
import { useWorkspaceResize } from "./hooks/useResize";
import { useSelectionInteraction } from "./hooks/useSelectionInteraction";
import { useSpectralData } from "./hooks/useSpectralData";
import { useSpectrogramHeader } from "./hooks/useSpectrogramHeader";
import { useWaveformHeader } from "./hooks/useWaveformHeader";
import { useWorkspaceWheel } from "./hooks/useWheel";
import { Ruler } from "./Ruler";

interface WorkspaceProps {
	readonly context: SessionContext;
}

export const Workspace: React.FC<WorkspaceProps> = resnapshot(({ context }) => {
	const { workspace, sessionStore } = context;

	const activeSnapshotPath = useActiveSnapshotPath(context);
	const waveformHeader = useWaveformHeader(activeSnapshotPath);
	const spectrogramHeader = useSpectrogramHeader(activeSnapshotPath);
	const durationMs = waveformHeader ? (waveformHeader.totalPoints / waveformHeader.resolution) * 1000 : 0;
	const channelCount = waveformHeader?.channels ?? 0;

	const lanesRef = useWorkspaceResize(context);

	const spectralData = useSpectralData(
		activeSnapshotPath,
		spectrogramHeader,
		waveformHeader,
		workspace.scrollX.value,
		workspace.pixelsPerSecond.value,
		workspace.viewportWidth.value,
	);

	const initialZoomApplied = useRef(false);

	useEffect(() => {
		if (initialZoomApplied.current) return;

		const viewportWidth = workspace.viewportWidth.value;

		if (viewportWidth > 0 && durationMs > 0) {
			initialZoomApplied.current = true;
			sessionStore.mutate(workspace, (proxy) => {
				proxy.pixelsPerSecond.committed.value = clampPixelsPerSecond(getMinPixelsPerSecond(viewportWidth, durationMs), viewportWidth, durationMs);
				proxy.scrollX.committed.value = 0;
			});
		}
	}, [durationMs, workspace, sessionStore, workspace.viewportWidth.value]);

	useEffect(() => {
		if (!initialZoomApplied.current) return;

		const viewportWidth = workspace.viewportWidth.value;
		if (viewportWidth <= 0 || durationMs <= 0) return;

		const currentPps = workspace.pixelsPerSecond.value;
		const clampedPps = clampPixelsPerSecond(currentPps, viewportWidth, durationMs);
		const maxScrollX = Math.max(0, msToPixels(durationMs, clampedPps) - viewportWidth);
		const currentScrollX = workspace.scrollX.value;
		const clampedScrollX = Math.min(currentScrollX, maxScrollX);

		if (clampedPps !== currentPps || clampedScrollX !== currentScrollX) {
			sessionStore.mutate(workspace, (proxy) => {
				proxy.pixelsPerSecond.committed.value = clampedPps;
				proxy.scrollX.committed.value = clampedScrollX;
			});
		}
	}, [workspace.viewportWidth.value, durationMs, workspace, sessionStore]);

	const handleWheel = useWorkspaceWheel(durationMs, context);
	const selectionHandlers = useSelectionInteraction(context);

	const handleMouseMove = useCallback(
		(event: React.MouseEvent) => {
			const rect = event.currentTarget.getBoundingClientRect();

			sessionStore.mutate(workspace, (proxy) => {
				proxy.cursorX.committed.value = event.clientX - rect.left;
			});
		},
		[workspace, sessionStore],
	);

	const handleMouseLeave = useCallback(() => {
		sessionStore.mutate(workspace, (proxy) => {
			proxy.cursorX.committed.value = -1;
		});
	}, [workspace, sessionStore]);

	const workspaceContext = useMemo((): WorkspaceContext | undefined => {
		if (!spectrogramHeader || !waveformHeader || channelCount === 0) return undefined;

		return {
			...context,
			spectrogramHeader,
			waveformHeader,
			spectralData,
			channelCount,
		};
	}, [context, spectrogramHeader, waveformHeader, spectralData, channelCount]);

	if (!workspaceContext) {
		return (
			<div className="flex h-full items-center justify-center bg-background">
				<p className="text-sm text-muted-foreground">Loading...</p>
			</div>
		);
	}

	const channels = Array.from({ length: channelCount }, (_, index) => index);
	const viewportHeight = workspace.viewportHeight.value;
	const laneHeight = viewportHeight > 0 ? viewportHeight / channelCount : 0;

	return (
		<div className="flex h-full min-w-0 flex-col overflow-hidden surface-instrument-panel">
			<div className="flex flex-shrink-0 border-b border-border pt-2">
				<div style={{ width: FREQUENCY_AXIS_WIDTH }} />
				<div className="min-w-0 flex-1 overflow-hidden">
					<Ruler context={context} />
				</div>
				<div style={{ width: AMPLITUDE_AXIS_WIDTH }} />
			</div>

			<div className="flex min-w-0 flex-1 overflow-hidden">
				<div className="flex flex-shrink-0 flex-col">
					{channels.map((channelIndex) => (
						<FrequencyAxis
							key={channelIndex}
							channelIndex={channelIndex}
							height={laneHeight}
							minFrequency={spectrogramHeader?.minFrequency ?? 20}
							maxFrequency={spectrogramHeader?.maxFrequency ?? 20000}
							frequencyScale={spectrogramHeader?.frequencyScale ?? "log"}
						/>
					))}
				</div>

				<div
					ref={lanesRef}
					className="relative min-w-0 flex-1 overflow-hidden surface-channel"
					onWheel={handleWheel}
					onPointerDown={selectionHandlers.onPointerDown}
					onPointerMove={selectionHandlers.onPointerMove}
					onPointerUp={selectionHandlers.onPointerUp}
					onMouseMove={handleMouseMove}
					onMouseLeave={handleMouseLeave}
				>
					<div className="flex h-full flex-col">
						{channels.map((channelIndex) => (
							<ChannelLane
								key={channelIndex}
								channelIndex={channelIndex}
								context={workspaceContext}
							/>
						))}
					</div>
					<Playhead context={context} />
					<SelectionOverlay
						laneHeight={laneHeight}
						context={context}
					/>
					<CursorIndicator context={context} />
				</div>

				<div className="flex flex-shrink-0 flex-col">
					{channels.map((channelIndex) => (
						<AmplitudeAxis
							key={channelIndex}
							height={laneHeight}
						/>
					))}
				</div>
			</div>
		</div>
	);
});
