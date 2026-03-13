const FREQUENCY_MARKERS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] as const;
const AXIS_WIDTH = 48;
const LABEL_HEIGHT = 14;

interface FrequencyAxisProps {
	readonly channelIndex: number;
	readonly height: number;
	readonly minFrequency: number;
	readonly maxFrequency: number;
}

function formatFrequency(hz: number): string {
	return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

export const FrequencyAxis: React.FC<FrequencyAxisProps> = ({ channelIndex, height, minFrequency, maxFrequency }) => {
	const logMin = Math.log(minFrequency);
	const logMax = Math.log(maxFrequency);
	const logRange = logMax - logMin;

	const visibleMarkers = FREQUENCY_MARKERS.filter((freq) => freq >= minFrequency && freq <= maxFrequency);

	return (
		<div className="relative flex-shrink-0 surface-instrument-panel" style={{ width: AXIS_WIDTH, height }}>
			<span className="absolute left-1 top-1 text-[10px] font-medium text-muted-foreground">
				{channelIndex}
			</span>
			<svg className="absolute inset-0" width={AXIS_WIDTH} height={height}>
				{visibleMarkers.map((freq) => {
					const yPosition = height * (1 - (Math.log(freq) - logMin) / logRange);
					if (yPosition < LABEL_HEIGHT || yPosition > height - 4) return null;

					return (
						<g key={freq}>
							<line x1={AXIS_WIDTH - 4} y1={yPosition} x2={AXIS_WIDTH} y2={yPosition} stroke="currentColor" className="text-muted-foreground/40" />
							<text x={AXIS_WIDTH - 6} y={yPosition + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
								{formatFrequency(freq)}
							</text>
						</g>
					);
				})}
			</svg>
		</div>
	);
};

export { AXIS_WIDTH as FREQUENCY_AXIS_WIDTH };
