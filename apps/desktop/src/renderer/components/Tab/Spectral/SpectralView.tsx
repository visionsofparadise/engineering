import { useEffect, useMemo, useRef } from "react";
import type { SnapshotContext } from "../../../models/Context";
import type { Mutable } from "../../../models/State";
import type { SnapshotState } from "../../../models/State/Snapshot";
import { useSelectionInteraction } from "../../../hooks/useSelectionInteraction";
import { useSpectralKeyboard } from "../../../hooks/useSpectralKeyboard";
import { useWheel } from "../../../hooks/useWheel";
import { ChannelLane } from "./ChannelLane";
import { Playhead } from "./Playhead";
import { SelectionOverlay } from "./SelectionOverlay";
import { SpectralNodeNav } from "./SpectralNodeNav";
import { SpectralRuler } from "./SpectralRuler";
import { SpectralTransport } from "./SpectralTransport";
import { FrequencyAxis, DbAxis } from "./SpectralAxes";

interface Props {
	readonly context: SnapshotContext;
}

export function SpectralView({ context }: Props) {
	const lanesContainerRef = useRef<HTMLDivElement>(null);
	const { snapshot, snapshotStore } = context;

	const proxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<Mutable<SnapshotState>>(snapshot._key),
		[snapshotStore, snapshot._key],
	);

	// Scroll and zoom via mouse wheel
	useWheel(lanesContainerRef, context);

	// Click-and-drag region selection / click-to-seek
	useSelectionInteraction(lanesContainerRef, context);

	// Keyboard shortcuts (space, arrows, home/end, escape)
	useSpectralKeyboard(context);

	// Track viewport size via ResizeObserver, writing to transient values
	useEffect(() => {
		const element = lanesContainerRef.current;

		if (!element || !proxy) return;

		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];

			if (!entry) return;

			const { width, height } = entry.contentRect;

			proxy.viewportWidth.transient.value = width;
			proxy.viewportHeight.transient.value = height;
		});

		observer.observe(element);

		return () => {
			observer.disconnect();
		};
	}, [proxy]);

	const channelCount = context.wavFile.channelCount;
	const channels = Array.from({ length: channelCount }, (_, ci) => ci);

	return (
		<div className="flex h-full flex-col bg-void">
			{/* NodeNav */}
			<SpectralNodeNav context={context} />

			{/* Ruler */}
			<SpectralRuler context={context} />

			{/* Main content: FrequencyAxis | ChannelLanes | DbAxis */}
			<div ref={lanesContainerRef} className="flex flex-1 overflow-hidden">
				<FrequencyAxis context={context} />

				<div className="relative flex flex-1 flex-col overflow-hidden">
					{channels.map((channelIndex) => (
						<ChannelLane
							key={channelIndex}
							context={context}
							channelIndex={channelIndex}
						/>
					))}
					<Playhead context={context} />
					<SelectionOverlay context={context} />
				</div>

				<DbAxis context={context} />
			</div>

			{/* Transport */}
			<SpectralTransport context={context} />
		</div>
	);
}
