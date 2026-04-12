import { useCallback, useMemo, useRef } from "react";
import type { SnapshotContext } from "../../../models/Context";
import type { SnapshotState } from "../../../models/State/Snapshot";
import type { PlaybackState } from "../../../models/State/Playback";
import type { Transient } from "../../../models/Transient";
import { useTransients } from "../../../hooks/useTransients";

interface Props {
	readonly context: SnapshotContext;
}

export function Playhead({ context }: Props) {
	const lineRef = useRef<HTMLDivElement>(null);

	const { snapshot, snapshotStore, playback } = context;

	const snapshotProxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<SnapshotState>(snapshot._key),
		[snapshotStore, snapshot._key],
	);

	const playbackProxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<PlaybackState>(playback._key),
		[snapshotStore, playback._key],
	);

	const currentMsTransient = playbackProxy?.currentMs;
	const scrollXTransient = snapshotProxy?.scrollX;
	const ppsTransient = snapshotProxy?.pixelsPerSecond;
	const viewportWidthTransient = snapshotProxy?.viewportWidth;

	const updatePosition = useCallback(() => {
		if (!lineRef.current || !currentMsTransient || !scrollXTransient || !ppsTransient || !viewportWidthTransient) return;

		const currentMs = currentMsTransient.value;
		const scrollX = scrollXTransient.value;
		const pixelsPerSecond = ppsTransient.value;
		const viewportWidth = viewportWidthTransient.value;

		const x = (currentMs / 1000) * pixelsPerSecond - scrollX;

		if (x < 0 || x > viewportWidth) {
			lineRef.current.style.display = "none";
		} else {
			lineRef.current.style.display = "";
			lineRef.current.style.transform = `translateX(${x}px)`;
		}
	}, [currentMsTransient, scrollXTransient, ppsTransient, viewportWidthTransient]);

	const transients = useMemo(
		() =>
			currentMsTransient && scrollXTransient && ppsTransient && viewportWidthTransient
				? [
						currentMsTransient as Transient<unknown>,
						scrollXTransient as Transient<unknown>,
						ppsTransient as Transient<unknown>,
						viewportWidthTransient as Transient<unknown>,
					]
				: [],
		[currentMsTransient, scrollXTransient, ppsTransient, viewportWidthTransient],
	);

	useTransients(transients, updatePosition);

	return (
		<div
			ref={lineRef}
			className="pointer-events-none absolute inset-y-0 left-0 w-px bg-primary"
		/>
	);
}
