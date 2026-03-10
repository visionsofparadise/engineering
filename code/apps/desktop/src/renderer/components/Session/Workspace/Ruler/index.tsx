import { useCallback, useRef } from "react";
import { useTransients } from "../../../../hooks/useTransients";
import type { SessionContext } from "../../../../models/Context";
import { formatTime, msToPixels, pixelsToMs } from "../../../../utils/time";

export const RULER_HEIGHT = 24;

interface RulerProps {
	readonly context: SessionContext;
}

interface TickInterval {
	major: number;
	minor: number;
}

function getTickInterval(pixelsPerSecond: number): TickInterval {
	const targetMs = (100 / pixelsPerSecond) * 1000;

	if (targetMs <= 500) return { major: 500, minor: 100 };
	if (targetMs <= 1000) return { major: 1000, minor: 250 };
	if (targetMs <= 2000) return { major: 2000, minor: 500 };
	if (targetMs <= 5000) return { major: 5000, minor: 1000 };
	if (targetMs <= 10000) return { major: 10000, minor: 2000 };
	if (targetMs <= 30000) return { major: 30000, minor: 5000 };
	if (targetMs <= 60000) return { major: 60000, minor: 10000 };
	if (targetMs <= 120000) return { major: 120000, minor: 30000 };
	if (targetMs <= 300000) return { major: 300000, minor: 60000 };
	return { major: 600000, minor: 120000 };
}

interface TickElement {
	container: HTMLDivElement;
	line: HTMLDivElement;
	label?: HTMLSpanElement;
}

export const Ruler: React.FC<RulerProps> = ({ context }) => {
	const { workspace } = context;
	const rulerRef = useRef<HTMLDivElement>(null);
	const ticksContainerRef = useRef<HTMLDivElement>(null);
	const majorPoolRef = useRef<Array<TickElement>>([]);
	const minorPoolRef = useRef<Array<TickElement>>([]);

	const createTickElement = useCallback((isMajor: boolean): TickElement => {
		const container = document.createElement("div");
		container.className = "absolute top-0 h-full";
		container.style.willChange = "transform";

		const line = document.createElement("div");

		if (isMajor) {
			line.className = "absolute bottom-0 w-px h-4 bg-muted-foreground/60";
			const label = document.createElement("span");
			label.className = "absolute text-[10px] text-muted-foreground whitespace-nowrap";
			label.style.left = "4px";
			label.style.bottom = "10px";
			container.appendChild(line);
			container.appendChild(label);
			return { container, line, label };
		}

		line.className = "absolute bottom-0 w-px h-2 bg-muted-foreground/30";
		container.appendChild(line);
		return { container, line };
	}, []);

	const getOrCreateTick = useCallback(
		(pool: Array<TickElement>, index: number, isMajor: boolean): TickElement => {
			const existing = pool[index];
			if (existing) return existing;

			const tick = createTickElement(isMajor);
			pool.push(tick);
			ticksContainerRef.current?.appendChild(tick.container);
			return tick;
		},
		[createTickElement],
	);

	useTransients([workspace.pixelsPerSecond, workspace.scrollX, workspace.viewportWidth], () => {
		if (!ticksContainerRef.current) return;

		const pps = workspace.pixelsPerSecond.value;
		const scrollX = workspace.scrollX.value;
		const viewportWidth = workspace.viewportWidth.value;

		const { major, minor } = getTickInterval(pps);

		const visibleStartMs = Math.max(0, pixelsToMs(scrollX - 200, pps));
		const visibleEndMs = pixelsToMs(scrollX + viewportWidth + 200, pps);

		let majorIndex = 0;
		let minorIndex = 0;

		for (let time = Math.floor(visibleStartMs / major) * major; time <= visibleEndMs; time += major) {
			if (time < 0) continue;

			const tick = getOrCreateTick(majorPoolRef.current, majorIndex, true);
			tick.container.style.transform = `translateX(${msToPixels(time, pps) - scrollX}px)`;
			tick.container.style.display = "";
			if (tick.label) {
				tick.label.textContent = formatTime(time);
			}
			majorIndex++;
		}

		for (let time = Math.floor(visibleStartMs / minor) * minor; time <= visibleEndMs; time += minor) {
			if (time < 0 || time % major === 0) continue;

			const tick = getOrCreateTick(minorPoolRef.current, minorIndex, false);
			tick.container.style.transform = `translateX(${msToPixels(time, pps) - scrollX}px)`;
			tick.container.style.display = "";
			minorIndex++;
		}

		for (let poolIndex = majorIndex; poolIndex < majorPoolRef.current.length; poolIndex++) {
			const tick = majorPoolRef.current[poolIndex];
			if (tick) tick.container.style.display = "none";
		}

		for (let poolIndex = minorIndex; poolIndex < minorPoolRef.current.length; poolIndex++) {
			const tick = minorPoolRef.current[poolIndex];
			if (tick) tick.container.style.display = "none";
		}
	});

	return (
		<div
			ref={rulerRef}
			className="relative w-full border-b border-border bg-muted"
			style={{ height: RULER_HEIGHT, touchAction: "none" }}
		>
			<div
				ref={ticksContainerRef}
				className="pointer-events-none absolute inset-0 overflow-visible"
			/>
		</div>
	);
};
