import type { FrequencyScale } from "../hooks/useSpectrogramHeader";

const AXIS_WIDTH = 48;
const MIN_PIXEL_GAP = 24;

interface FrequencyAxisProps {
	readonly channelIndex: number;
	readonly height: number;
	readonly minFrequency: number;
	readonly maxFrequency: number;
	readonly frequencyScale: FrequencyScale;
}

function formatFrequency(hz: number): string {
	if (hz >= 10000) {
		const kHz = hz / 1000;
		return kHz === Math.floor(kHz) ? `${kHz}k` : `${kHz.toFixed(1)}k`;
	}
	if (hz >= 1000) {
		const kHz = hz / 1000;
		return kHz === Math.floor(kHz) ? `${kHz}k` : `${kHz.toFixed(1)}k`;
	}
	return String(Math.round(hz));
}

function freqToMel(freq: number): number {
	return 2595 * Math.log10(1 + freq / 700);
}

function melToFreq(mel: number): number {
	return 700 * (Math.pow(10, mel / 2595) - 1);
}

function freqToErb(freq: number): number {
	return 21.4 * Math.log10(1 + 0.00437 * freq);
}

function erbToFreq(erb: number): number {
	return (Math.pow(10, erb / 21.4) - 1) / 0.00437;
}

interface ScaleFunctions {
	readonly toNormalized: (freq: number, min: number, max: number) => number;
	readonly fromNormalized: (normalized: number, min: number, max: number) => number;
}

function getScaleFunctions(scale: FrequencyScale): ScaleFunctions {
	switch (scale) {
		case "linear":
			return {
				toNormalized: (freq, min, max) => (freq - min) / (max - min),
				fromNormalized: (normalized, min, max) => min + normalized * (max - min),
			};
		case "log":
			return {
				toNormalized: (freq, min, max) => (Math.log(freq) - Math.log(min)) / (Math.log(max) - Math.log(min)),
				fromNormalized: (normalized, min, max) => Math.exp(Math.log(min) + normalized * (Math.log(max) - Math.log(min))),
			};
		case "mel":
			return {
				toNormalized: (freq, min, max) => (freqToMel(freq) - freqToMel(min)) / (freqToMel(max) - freqToMel(min)),
				fromNormalized: (normalized, min, max) => melToFreq(freqToMel(min) + normalized * (freqToMel(max) - freqToMel(min))),
			};
		case "erb":
			return {
				toNormalized: (freq, min, max) => (freqToErb(freq) - freqToErb(min)) / (freqToErb(max) - freqToErb(min)),
				fromNormalized: (normalized, min, max) => erbToFreq(freqToErb(min) + normalized * (freqToErb(max) - freqToErb(min))),
			};
	}
}

function niceRound(value: number): number {
	const sigFigs = value >= 10000 ? 2 : 1;
	const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - (sigFigs - 1));
	return Math.round(value / magnitude) * magnitude;
}

function generateMarkers(min: number, max: number, height: number, scale: ScaleFunctions): Array<number> {
	const count = Math.floor(height / MIN_PIXEL_GAP);
	if (count < 1) return [];

	const step = 1 / (count + 1);

	const markers: Array<number> = [];
	let prev = 0;

	for (let index = 1; index <= count; index++) {
		const freq = scale.fromNormalized(index * step, min, max);
		const nice = niceRound(freq);
		if (nice > min && nice < max && nice !== prev) {
			markers.push(nice);
			prev = nice;
		}
	}

	return markers;
}

export const FrequencyAxis: React.FC<FrequencyAxisProps> = ({ height, minFrequency, maxFrequency, frequencyScale }) => {
	const scale = getScaleFunctions(frequencyScale);

	const markers = generateMarkers(minFrequency, maxFrequency, height, scale);

	const positioned = markers.map((freq) => ({
		freq,
		y: height * (1 - scale.toNormalized(freq, minFrequency, maxFrequency)),
	}));

	const visible: typeof positioned = [];
	let lastLabel = "";
	for (const marker of positioned) {
		if (marker.y < 10 || marker.y > height - 4) continue;
		const last = visible[visible.length - 1];
		if (last && Math.abs(marker.y - last.y) < MIN_PIXEL_GAP) continue;
		const label = formatFrequency(marker.freq);
		if (label === lastLabel) continue;
		lastLabel = label;
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
