import { useRef } from "react";
import { useTransients } from "../../../../hooks/useTransients";
import type { SessionContext } from "../../../../models/Context";
import { formatTime, pixelsToMs } from "../../../../utils/time";

interface CursorIndicatorProps {
	readonly context: SessionContext;
}

export const CursorIndicator: React.FC<CursorIndicatorProps> = ({ context }) => {
	const { workspace } = context;

	const indicatorRef = useRef<HTMLDivElement>(null);
	const labelRef = useRef<HTMLSpanElement>(null);

	useTransients([workspace.cursorX, workspace.scrollX, workspace.pixelsPerSecond], () => {
		const indicator = indicatorRef.current;

		if (!indicator) return;

		const cursorX = workspace.cursorX.value;

		if (cursorX < 0) {
			indicator.style.opacity = "0";

			return;
		}

		indicator.style.opacity = "1";
		indicator.style.transform = `translateX(${cursorX}px)`;

		if (labelRef.current) {
			const ms = pixelsToMs(cursorX + workspace.scrollX.value, workspace.pixelsPerSecond.value);

			labelRef.current.textContent = formatTime(Math.max(0, ms));
		}
	});

	return (
		<div className="pointer-events-none absolute inset-0 z-15 overflow-hidden">
			<div
				ref={indicatorRef}
				className="absolute left-0 top-0 h-full transition-opacity duration-75"
				style={{ opacity: 0 }}
			>
				<div
					className="absolute left-0 top-0 h-full w-[1px]"
					style={{
						background: "repeating-linear-gradient(to bottom, rgba(255,255,255,0.3) 0, rgba(255,255,255,0.3) 4px, transparent 4px, transparent 8px)",
					}}
				/>
				<span
					ref={labelRef}
					className="absolute left-1 top-0 text-[10px] text-muted-foreground whitespace-nowrap"
				/>
			</div>
		</div>
	);
};
