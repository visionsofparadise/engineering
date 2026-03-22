export const AMPLITUDE_AXIS_WIDTH = 40;

const MIN_PIXEL_GAP = 16;

interface AmplitudeAxisProps {
	readonly height: number;
}

/** Convert dB to linear amplitude (0..1) */
function dbToAmplitude(db: number): number {
	if (db <= -96) return 0;

	return Math.pow(10, db / 20);
}

/** Generate dB markers, filtering for pixel spacing in both halves */
function generateDbMarkers(halfHeight: number): Array<number> {
	const all = [0, -1, -2, -3, -4, -6, -8, -10, -15, -20, -30, -40, -50, -60];
	const result: Array<number> = [];
	let lastTopY = -Infinity;

	for (const db of all) {
		const amp = dbToAmplitude(db);
		const yTop = halfHeight * (1 - amp);
		const yBottom = halfHeight * (1 + amp);

		if (yTop < 8) continue;
		if (yTop - lastTopY < MIN_PIXEL_GAP && result.length > 0) continue;
		// Ensure top and bottom labels don't overlap across the center
		if (yBottom - yTop < MIN_PIXEL_GAP) continue;

		result.push(db);
		lastTopY = yTop;
	}

	return result;
}

export const AmplitudeAxis: React.FC<AmplitudeAxisProps> = ({ height }) => {
	const halfHeight = height / 2;
	const markers = generateDbMarkers(halfHeight);

	return (
		<div
			className="relative flex-shrink-0"
			style={{ width: AMPLITUDE_AXIS_WIDTH, height }}
		>
			<svg
				className="absolute inset-0"
				width={AMPLITUDE_AXIS_WIDTH}
				height={height}
			>
				<text x={7} y={10} className="fill-muted-foreground/60 text-[8px]">dB</text>
				{markers.map((db) => {
					const amp = dbToAmplitude(db);
					const yTop = halfHeight * (1 - amp);
					const yBottom = halfHeight * (1 + amp);
					const isZero = db === 0;

					return (
						<g key={db}>
							<line x1={0} y1={yTop} x2={isZero ? 6 : 4} y2={yTop} stroke="currentColor" className={isZero ? "text-muted-foreground/50" : "text-muted-foreground/40"} />
							<text x={isZero ? 8 : 7} y={yTop + 3} className={isZero ? "fill-muted-foreground text-[8px]" : "fill-muted-foreground text-[8px]"}>{db}</text>
							<line x1={0} y1={yBottom} x2={isZero ? 6 : 4} y2={yBottom} stroke="currentColor" className={isZero ? "text-muted-foreground/50" : "text-muted-foreground/40"} />
							<text x={isZero ? 8 : 7} y={yBottom + 3} className={isZero ? "fill-muted-foreground text-[8px]" : "fill-muted-foreground text-[8px]"}>{db}</text>
						</g>
					);
				})}
				{/* Center line: -∞ dB */}
				<line x1={0} y1={halfHeight} x2={4} y2={halfHeight} stroke="currentColor" className="text-muted-foreground/20" />
			</svg>
		</div>
	);
};
