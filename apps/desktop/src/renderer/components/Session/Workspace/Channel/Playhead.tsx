import { useRef } from "react";
import { useTransients } from "../../../../hooks/useTransients";
import type { SessionContext } from "../../../../models/Context";
import { msToPixels } from "../../../../utils/time";

interface PlayheadProps {
	readonly context: SessionContext;
}

export const Playhead: React.FC<PlayheadProps> = ({ context }) => {
	const { workspace, playback } = context;
	const playheadRef = useRef<HTMLDivElement>(null);

	useTransients([workspace.pixelsPerSecond, workspace.scrollX, playback.currentMs], () => {
		if (!playheadRef.current) return;
		const xPosition = msToPixels(playback.currentMs.value, workspace.pixelsPerSecond.value) - workspace.scrollX.value;
		playheadRef.current.style.transform = `translateX(${xPosition}px)`;
	});

	return (
		<div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
			<div
				ref={playheadRef}
				className="absolute left-0 top-0 h-full w-[1px] bg-red-500"
			>
				<div className="absolute left-1/2 top-0 -translate-x-1/2">
					<div
						className="border-l-4 border-r-4 border-t-8 border-l-transparent border-r-transparent border-t-red-500"
						style={{ width: 0, height: 0 }}
					/>
				</div>
			</div>
		</div>
	);
};
