import type { SnapshotContext } from "../../../models/Context";

const FREQ_LABELS: ReadonlyArray<{ hz: number; label: string }> = [
	{ hz: 20, label: "20" },
	{ hz: 50, label: "50" },
	{ hz: 100, label: "100" },
	{ hz: 200, label: "200" },
	{ hz: 500, label: "500" },
	{ hz: 1000, label: "1k" },
	{ hz: 2000, label: "2k" },
	{ hz: 5000, label: "5k" },
	{ hz: 10000, label: "10k" },
	{ hz: 20000, label: "20k" },
];

const FREQ_MIN = 20;

function freqToMel(hz: number): number {
	return 2595 * Math.log10(1 + hz / 700);
}

function freqToY(hz: number, nyquist: number): number {
	const melMin = freqToMel(FREQ_MIN);
	const melMax = freqToMel(nyquist);
	const melHz = freqToMel(hz);

	return 1 - (melHz - melMin) / (melMax - melMin);
}

interface FrequencyAxisProps {
	readonly context: SnapshotContext;
}

export function FrequencyAxis({ context }: FrequencyAxisProps) {
	const nyquist = context.wavFile.sampleRate / 2;
	const visibleLabels = FREQ_LABELS.filter((entry) => entry.hz <= nyquist);

	return (
		<div className="relative w-12 shrink-0 bg-void font-technical text-xs tabular-nums text-chrome-text-secondary">
			{visibleLabels.map(({ hz, label }) => {
				const yPct = freqToY(hz, nyquist) * 100;

				return (
					<div key={hz} className="absolute right-0 flex items-center" style={{ top: `${yPct}%`, transform: "translateY(-50%)" }}>
						<span className="pr-1.5">{label}</span>
						<div className="absolute right-0 h-px w-1 bg-chrome-border-subtle" />
					</div>
				);
			})}
		</div>
	);
}

const DB_HALF_LABELS = [0, -3, -6, -12, -24];

function dbToLinear(db: number): number {
	return Math.pow(10, db / 20);
}

interface DbAxisProps {
	readonly context: SnapshotContext;
}

export function DbAxis({ context }: DbAxisProps) {
	void context;

	return (
		<div className="relative w-9 shrink-0 bg-void font-technical text-xs tabular-nums text-chrome-text-secondary">
			{/* Top half: 0dB near top -> approaching 50% center */}
			{DB_HALF_LABELS.map((db) => {
				const amp = db === 0 ? 1 : dbToLinear(db);
				const yPct = (1 - amp) * 50;

				return (
					<div
						key={`t${db}`}
						className="absolute left-0 flex items-center"
						style={{
							top: db === 0 ? "0px" : `${yPct}%`,
							transform: db === 0 ? undefined : "translateY(-50%)",
						}}
					>
						<div className="absolute left-0 h-px w-1 bg-chrome-border-subtle" />
						<span className="pl-1.5">{db}</span>
					</div>
				);
			})}

			{/* Center: -inf */}
			<div className="absolute left-0 flex items-center" style={{ top: "50%", transform: "translateY(-50%)" }}>
				<div className="absolute left-0 h-px w-1 bg-chrome-border-subtle" />
				<span className="pl-1.5">{"\u2212\u221E"}</span>
			</div>

			{/* Bottom half: mirror */}
			{DB_HALF_LABELS.map((db) => {
				const amp = db === 0 ? 1 : dbToLinear(db);
				const yPct = 50 + amp * 50;

				return (
					<div
						key={`b${db}`}
						className="absolute left-0 flex items-center"
						style={{
							bottom: db === 0 ? "0px" : undefined,
							top: db === 0 ? undefined : `${yPct}%`,
							transform: db === 0 ? undefined : "translateY(-50%)",
						}}
					>
						<div className="absolute left-0 h-px w-1 bg-chrome-border-subtle" />
						<span className="pl-1.5">{db}</span>
					</div>
				);
			})}
		</div>
	);
}
