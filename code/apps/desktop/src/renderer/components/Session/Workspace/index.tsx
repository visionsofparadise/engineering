import { resnapshot } from "../../../models/ProxyStore/resnapshot";
import { useCallback, useEffect, useRef } from "react";
import type { SessionContext } from "../../../models/Context";
import { clampPixelsPerSecond, getMinPixelsPerSecond } from "../../../utils/time";
import { AmplitudeAxis, AMPLITUDE_AXIS_WIDTH } from "./Channel/AmplitudeAxis";
import { CursorIndicator } from "./Channel/CursorIndicator";
import { Playhead } from "./Channel/Playhead";
import { FrequencyAxis, FREQUENCY_AXIS_WIDTH } from "./Channel/FrequencyAxis";
import { ChannelLane } from "./Channel/Lane";
import { SelectionOverlay } from "./Channel/SelectionOverlay";
import { useActiveSnapshotPath } from "../hooks/useActiveSnapshotPath";
import { useSelectionInteraction } from "./hooks/useSelectionInteraction";
import { useSpectrogramHeader } from "./hooks/useSpectrogramHeader";
import { useWaveformHeader } from "./hooks/useWaveformHeader";
import { useWorkspaceResize } from "./hooks/useResize";
import { useWorkspaceWheel } from "./hooks/useWheel";
import { Ruler } from "./Ruler";

interface WorkspaceProps {
	readonly context: SessionContext;
}

export const Workspace: React.FC<WorkspaceProps> = resnapshot(({ context }) => {
	const { workspace, sessionStore } = context;
	const lanesRef = useRef<HTMLDivElement>(null);

	const activeSnapshotPath = useActiveSnapshotPath(context);
	const waveformHeader = useWaveformHeader(activeSnapshotPath);
	const spectrogramHeader = useSpectrogramHeader(activeSnapshotPath);
	const durationMs = waveformHeader ? (waveformHeader.totalPoints / waveformHeader.resolution) * 1000 : 0;
	const channelCount = waveformHeader?.channels ?? 0;

	useWorkspaceResize(lanesRef, context);

	useEffect(() => {
		const viewportWidth = workspace.viewportWidth.value;

		if (viewportWidth > 0 && durationMs > 0) {
			sessionStore.mutate(workspace, (proxy) => {
				proxy.pixelsPerSecond.committed.value = clampPixelsPerSecond(getMinPixelsPerSecond(viewportWidth, durationMs), viewportWidth, durationMs);
				proxy.scrollX.committed.value = 0;
			});
		}
	}, [durationMs, workspace, sessionStore]);

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

	if (channelCount === 0) {
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
								laneHeight={laneHeight}
								context={context}
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
