import type { SessionContext } from "../../../../models/Context";
import { useActiveSnapshotPath } from "../../hooks/useActiveSnapshotPath";
import { useSpectrogram } from "../hooks/useSpectrogram";
import { useSpectrogramHeader } from "../hooks/useSpectrogramHeader";
import { useWaveform } from "../hooks/useWaveform";
import { SpectrogramCanvas } from "./SpectrogramCanvas";
import { WaveformCanvas } from "./WaveformCanvas";

interface ChannelLaneProps {
	readonly channelIndex: number;
	readonly laneHeight: number;
	readonly context: SessionContext;
}

const DB_RANGE = [-80, 0] as const;

export const ChannelLane: React.FC<ChannelLaneProps> = ({ channelIndex, laneHeight, context }) => {
	const viewportWidth = context.workspace.viewportWidth.value;

	const activeSnapshotPath = useActiveSnapshotPath(context);
	const spectrogramHeader = useSpectrogramHeader(activeSnapshotPath);
	const waveformChannels = useWaveform(activeSnapshotPath);
	const spectrogramChannels = useSpectrogram(activeSnapshotPath);

	const waveformData = waveformChannels?.[channelIndex];
	const spectrogramData = spectrogramChannels?.[channelIndex];

	return (
		<div
			className="relative"
			style={{ width: viewportWidth, height: laneHeight }}
		>
			{spectrogramData && spectrogramHeader && (
				<div className="absolute inset-0">
					<SpectrogramCanvas
						data={spectrogramData}
						numFrames={spectrogramHeader.numFrames}
						numBins={spectrogramHeader.numBins}
						width={viewportWidth}
						height={laneHeight}
						dbRange={DB_RANGE}
					/>
				</div>
			)}
			{waveformData && (
				<div
					className="absolute inset-0"
					style={{ opacity: 0.7 }}
				>
					<WaveformCanvas
						data={waveformData}
						width={viewportWidth}
						height={laneHeight}
						color="#ffffff"
						opacity={1}
					/>
				</div>
			)}
		</div>
	);
};
