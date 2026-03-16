import type { WorkspaceContext } from "../../../../models/Context";
import { SpectrogramCanvas } from "./SpectrogramCanvas";
import { WaveformCanvas } from "./WaveformCanvas";

interface ChannelLaneProps {
	readonly channelIndex: number;
	readonly context: WorkspaceContext;
}

export const ChannelLane: React.FC<ChannelLaneProps> = ({ channelIndex, context }) => {
	const { workspace, channelCount } = context;
	const viewportHeight = workspace.viewportHeight.value;
	const laneHeight = viewportHeight > 0 ? viewportHeight / channelCount : 0;

	return (
		<div className="relative bg-black" style={{ height: laneHeight }}>
			<SpectrogramCanvas channelIndex={channelIndex} context={context} />
			<WaveformCanvas channelIndex={channelIndex} context={context} />
			<span className="absolute left-2 top-1.5 z-10 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{channelIndex}</span>
		</div>
	);
};
