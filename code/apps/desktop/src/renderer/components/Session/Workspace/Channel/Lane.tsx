import type { SessionContext } from "../../../../models/Context";

interface ChannelLaneProps {
	readonly channelIndex: number;
	readonly laneHeight: number;
	readonly context: SessionContext;
}

// TODO: re-enable waveform and spectrogram loading
export const ChannelLane: React.FC<ChannelLaneProps> = ({ channelIndex, laneHeight }) => (
		<div
			className="relative bg-black"
			style={{ height: laneHeight }}
		>
			<span className="absolute left-2 top-1.5 z-10 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
				{channelIndex}
			</span>
		</div>
	);
