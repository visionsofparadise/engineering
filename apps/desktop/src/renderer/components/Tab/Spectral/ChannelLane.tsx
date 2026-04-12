import type { MouseEvent } from "react";
import { SpectrogramCanvas, WaveformCanvas } from "@e9g/spectral-display";
import { THEME_COLORS } from "@e9g/design-system";
import type { SnapshotContext } from "../../../models/Context";

interface Props {
	readonly context: SnapshotContext;
	readonly channelIndex: number;
}

export function ChannelLane({ context, channelIndex }: Props) {
	void channelIndex;

	const { spectralResult, playbackEngine, snapshot, snapshotStore } = context;
	const theme = context.app.theme;
	const waveformColor = THEME_COLORS[theme].waveform;

	const handleClick = (event: MouseEvent<HTMLDivElement>) => {
		const rect = event.currentTarget.getBoundingClientRect();
		const clickX = event.clientX - rect.left;

		const proxy = snapshotStore.dangerouslyGetProxy<{
			scrollX: { value: number };
			pixelsPerSecond: { value: number };
		}>(snapshot._key);

		if (!proxy) return;

		const scrollX = proxy.scrollX.value;
		const pixelsPerSecond = proxy.pixelsPerSecond.value;
		const ms = ((scrollX + clickX) / pixelsPerSecond) * 1000;

		playbackEngine.seek(ms);
	};

	if (spectralResult.status !== "ready") {
		return <div className="relative flex-1 bg-void" />;
	}

	return (
		<div className="relative flex-1 bg-void" onClick={handleClick}>
			<div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
				<SpectrogramCanvas
					computeResult={spectralResult}
					canvasScale={window.devicePixelRatio}
				/>
			</div>
			<div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
				<WaveformCanvas
					computeResult={spectralResult}
					color={waveformColor}
				/>
			</div>
		</div>
	);
}
