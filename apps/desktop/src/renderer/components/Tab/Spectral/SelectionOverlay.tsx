import { useMemo, useRef } from "react";
import type { SnapshotContext } from "../../../models/Context";
import type { SnapshotState } from "../../../models/State/Snapshot";
import type { SelectionState } from "../../../models/State/Selection";
import type { Transient } from "../../../models/Transient";
import { useTransients } from "../../../hooks/useTransients";

interface Props {
	readonly context: SnapshotContext;
}

export function SelectionOverlay({ context }: Props) {
	const { snapshot, snapshotStore, selection } = context;

	const overlayRef = useRef<HTMLDivElement>(null);
	const leftBorderRef = useRef<HTMLDivElement>(null);
	const rightBorderRef = useRef<HTMLDivElement>(null);

	const snapshotProxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<SnapshotState>(snapshot._key),
		[snapshotStore, snapshot._key],
	);

	const selectionProxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<SelectionState>(selection._key),
		[snapshotStore, selection._key],
	);

	const transients = useMemo(() => {
		if (!snapshotProxy || !selectionProxy) return [];

		return [
			selectionProxy.startFrame as Transient<unknown>,
			selectionProxy.endFrame as Transient<unknown>,
			snapshotProxy.scrollX as Transient<unknown>,
			snapshotProxy.pixelsPerSecond as Transient<unknown>,
		];
	}, [snapshotProxy, selectionProxy]);

	useTransients(transients, () => {
		if (!overlayRef.current || !leftBorderRef.current || !rightBorderRef.current) return;
		if (!snapshotProxy || !selectionProxy) return;
		if (!selectionProxy.active) {
			overlayRef.current.style.display = "none";

			return;
		}

		const pps = snapshotProxy.pixelsPerSecond.value;
		const scrollX = snapshotProxy.scrollX.value;
		const sampleRate = context.wavFile.sampleRate;

		const startFrame = selectionProxy.startFrame.value;
		const endFrame = selectionProxy.endFrame.value;

		const lo = Math.min(startFrame, endFrame);
		const hi = Math.max(startFrame, endFrame);

		const startPx = (lo / sampleRate) * pps - scrollX;
		const endPx = (hi / sampleRate) * pps - scrollX;

		overlayRef.current.style.display = "";
		overlayRef.current.style.left = `${startPx}px`;
		overlayRef.current.style.width = `${endPx - startPx}px`;

		leftBorderRef.current.style.left = "0px";
		rightBorderRef.current.style.right = "0px";
	});

	if (!selection.active) return null;

	return (
		<div
			ref={overlayRef}
			className="pointer-events-none absolute top-0 bottom-0"
		>
			<div className="absolute inset-0 bg-[#5A9ECF20]" />
			<div ref={leftBorderRef} className="absolute top-0 bottom-0 w-[1px] bg-[#5A9ECF]" />
			<div ref={rightBorderRef} className="absolute top-0 bottom-0 w-[1px] bg-[#5A9ECF]" />
		</div>
	);
}
