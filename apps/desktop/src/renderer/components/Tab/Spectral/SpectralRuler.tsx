import { useRef, useEffect, useCallback, useMemo } from "react";
import type { SnapshotContext } from "../../../models/Context";
import type { SnapshotState } from "../../../models/State/Snapshot";
import type { Transient } from "../../../models/Transient";
import { useTransients } from "../../../hooks/useTransients";

const POOL_SIZE = 120;

function formatTime(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	const secs = seconds % 60;
	const secsWhole = Math.floor(secs);
	const ms = Math.round((secs - secsWhole) * 1000);

	if (minutes > 0) {
		return `${minutes}:${secsWhole.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;
	}

	return `${secsWhole}.${ms.toString().padStart(3, "0")}`;
}

function computeTickInterval(pixelsPerSecond: number): { majorSeconds: number; minorDivisions: number } {
	// Choose a major tick interval that keeps labels roughly 80-150px apart
	const targetPx = 100;
	const rawSeconds = targetPx / pixelsPerSecond;

	const candidates = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

	let majorSeconds = 1;

	for (const candidate of candidates) {
		majorSeconds = candidate;

		if (candidate >= rawSeconds) break;
	}

	const minorDivisions = majorSeconds <= 0.01 ? 4 : 5;

	return { majorSeconds, minorDivisions };
}

interface TickElement {
	readonly container: HTMLDivElement;
	readonly line: HTMLDivElement;
	readonly label: HTMLSpanElement;
}

function createTickElement(parent: HTMLElement): TickElement {
	const container = document.createElement("div");

	container.style.position = "absolute";
	container.style.bottom = "0";

	const line = document.createElement("div");

	line.style.position = "absolute";
	line.style.bottom = "0";
	line.style.width = "1px";

	const label = document.createElement("span");

	label.style.position = "absolute";
	label.style.bottom = "2px";
	label.style.left = "4px";
	label.style.whiteSpace = "nowrap";

	container.appendChild(line);
	container.appendChild(label);
	parent.appendChild(container);

	return { container, line, label };
}

interface Props {
	readonly context: SnapshotContext;
}

export function SpectralRuler({ context }: Props) {
	const containerRef = useRef<HTMLDivElement>(null);
	const tickPoolRef = useRef<Array<TickElement>>([]);
	const bottomLineRef = useRef<HTMLDivElement>(null);

	const { snapshot, snapshotStore } = context;

	const proxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<SnapshotState>(snapshot._key),
		[snapshotStore, snapshot._key],
	);

	const scrollXTransient = proxy?.scrollX;
	const ppsTransient = proxy?.pixelsPerSecond;

	// Initialize tick pool
	useEffect(() => {
		const container = containerRef.current;

		if (!container) return;

		const pool: Array<TickElement> = [];

		for (let pi = 0; pi < POOL_SIZE; pi++) {
			pool.push(createTickElement(container));
		}

		tickPoolRef.current = pool;

		return () => {
			for (const tick of pool) {
				tick.container.remove();
			}

			tickPoolRef.current = [];
		};
	}, []);

	const updateTicks = useCallback(() => {
		const container = containerRef.current;

		if (!container || !scrollXTransient || !ppsTransient) return;

		const pool = tickPoolRef.current;
		const scrollX = scrollXTransient.value;
		const pixelsPerSecond = ppsTransient.value;
		const viewWidth = container.clientWidth;

		const { majorSeconds, minorDivisions } = computeTickInterval(pixelsPerSecond);
		const minorSeconds = majorSeconds / minorDivisions;

		const startTime = scrollX / pixelsPerSecond;
		const endTime = (scrollX + viewWidth) / pixelsPerSecond;

		const firstMinor = Math.floor(startTime / minorSeconds) * minorSeconds;

		let poolIndex = 0;

		for (let time = firstMinor; time <= endTime + minorSeconds; time += minorSeconds) {
			if (poolIndex >= pool.length) break;

			const tick = pool[poolIndex];

			if (!tick) continue;

			const px = time * pixelsPerSecond - scrollX;

			if (px < -50 || px > viewWidth + 50) continue;

			const isMajor = Math.abs(time / majorSeconds - Math.round(time / majorSeconds)) < 1e-9;

			tick.container.style.display = "";
			tick.container.style.left = `${px}px`;

			tick.line.className = isMajor ? "bg-chrome-border" : "bg-chrome-border-subtle";
			tick.line.style.height = isMajor ? "10px" : "6px";

			if (isMajor) {
				tick.label.textContent = formatTime(Math.max(0, time));
				tick.label.style.display = "";
			} else {
				tick.label.style.display = "none";
			}

			poolIndex++;
		}

		// Hide unused ticks
		for (let ti = poolIndex; ti < pool.length; ti++) {
			const tick = pool[ti];

			if (tick) tick.container.style.display = "none";
		}
	}, [scrollXTransient, ppsTransient]);

	const transients = useMemo(
		() =>
			scrollXTransient && ppsTransient
				? [scrollXTransient as Transient<unknown>, ppsTransient as Transient<unknown>]
				: [],
		[scrollXTransient, ppsTransient],
	);

	useTransients(transients, updateTicks);

	return (
		<div
			ref={containerRef}
			className="relative h-6 shrink-0 overflow-hidden bg-void font-technical text-xs tabular-nums text-chrome-text-secondary"
		>
			<div
				ref={bottomLineRef}
				className="absolute bottom-0 left-0 right-0 h-px bg-chrome-border-subtle"
			/>
		</div>
	);
}
