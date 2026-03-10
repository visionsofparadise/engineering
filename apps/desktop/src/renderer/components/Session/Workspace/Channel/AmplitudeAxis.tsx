export const DB_MARKERS = [0, -6, -12, -18, -24, -48] as const;
export const AMPLITUDE_AXIS_WIDTH = 40;

interface AmplitudeAxisProps {
	readonly height: number;
}

export const AmplitudeAxis: React.FC<AmplitudeAxisProps> = ({ height }) => {
	const halfHeight = height / 2;

	return (
		<div
			className="relative flex-shrink-0 bg-background"
			style={{ width: AMPLITUDE_AXIS_WIDTH, height }}
		>
			<svg
				className="absolute inset-0"
				width={AMPLITUDE_AXIS_WIDTH}
				height={height}
			>
				{DB_MARKERS.map((db) => {
					const normalized = 1 - Math.abs(db) / 48;
					const yPosition = halfHeight * (1 - normalized);
					if (yPosition < 4 || yPosition > halfHeight - 4) return null;

					return (
						<g key={db}>
							<line
								x1={0}
								y1={yPosition}
								x2={4}
								y2={yPosition}
								stroke="currentColor"
								className="text-muted-foreground/40"
							/>
							<text
								x={6}
								y={yPosition + 3}
								className="fill-muted-foreground text-[9px]"
							>
								{db}
							</text>
						</g>
					);
				})}
			</svg>
		</div>
	);
};
