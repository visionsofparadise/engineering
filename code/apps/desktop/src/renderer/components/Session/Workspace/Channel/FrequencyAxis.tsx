const AXIS_WIDTH = 48;
const MIN_PIXEL_GAP = 24;

interface FrequencyAxisProps {
	readonly channelIndex: number;
	readonly height: number;
	readonly minFrequency: number;
	readonly maxFrequency: number;
}

function formatFrequency(hz: number): string {
	if (hz >= 10000) {
		const kHz = hz / 1000;
		return kHz === Math.floor(kHz) ? `${kHz}k` : `${kHz.toFixed(1)}k`;
	}
	if (hz >= 1000) {
		return `${Math.round(hz / 1000)}k`;
	}
	return String(Math.round(hz / 100) * 100);
}

/** Mel scale: perceptual frequency mapping used in audio software */
function freqToMel(freq: number): number {
	return 2595 * Math.log10(1 + freq / 700);
}

function niceRound(value: number): number {
	const sigFigs = value >= 10000 ? 2 : 1;
	const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - (sigFigs - 1));
	return Math.round(value / magnitude) * magnitude;
}

function generateMarkers(min: number, max: number, height: number): Array<number> {
	const melMin = freqToMel(min);
	const melMax = freqToMel(max);
	const melRange = melMax - melMin;

	const count = Math.floor(height / MIN_PIXEL_GAP);
	if (count < 1) return [];

	const melStep = melRange / (count + 1);

	const markers: Array<number> = [];
	let prev = 0;

	for (let step = 1; step <= count; step++) {
		const mel = melMin + step * melStep;
		const freq = 700 * (Math.pow(10, mel / 2595) - 1);
		const nice = niceRound(freq);
		if (nice > min && nice < max && nice !== prev) {
			markers.push(nice);
			prev = nice;
		}
	}

	return markers;
}

export const FrequencyAxis: React.FC<FrequencyAxisProps> = ({ height, minFrequency, maxFrequency }) => {
	const melMin = freqToMel(minFrequency);
	const melRange = freqToMel(maxFrequency) - melMin;

	const markers = generateMarkers(minFrequency, maxFrequency, height);

	// Filter overlapping labels by checking pixel distance
	const positioned = markers.map((freq) => ({
		freq,
		y: height * (1 - (freqToMel(freq) - melMin) / melRange),
	}));

	const visible: typeof positioned = [];
	for (const marker of positioned) {
		if (marker.y < 10 || marker.y > height - 4) continue;
		const last = visible[visible.length - 1];
		if (last && Math.abs(marker.y - last.y) < MIN_PIXEL_GAP) continue;
		visible.push(marker);
	}

	return (
		<div className="relative flex-shrink-0" style={{ width: AXIS_WIDTH, height }}>
			<svg className="absolute inset-0" width={AXIS_WIDTH} height={height}>
				<text x={AXIS_WIDTH - 6} y={10} textAnchor="end" className="fill-muted-foreground/60 text-[8px]">Hz</text>
				{visible.map(({ freq, y }) => (
					<g key={freq}>
						<line x1={AXIS_WIDTH - 4} y1={y} x2={AXIS_WIDTH} y2={y} stroke="currentColor" className="text-muted-foreground/40" />
						<text x={AXIS_WIDTH - 6} y={y + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">
							{formatFrequency(freq)}
						</text>
					</g>
				))}
			</svg>
		</div>
	);
};

export { AXIS_WIDTH as FREQUENCY_AXIS_WIDTH };
