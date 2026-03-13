interface TypeLevel {
	name: string;
	className: string;
	fontFamily: string;
	weight: string;
	size: string;
	lineHeight: string;
	letterSpacing: string;
	sampleText: string;
}

const TYPE_SCALE: Array<TypeLevel> = [
	{
		name: "Display",
		className: "text-3xl font-semibold tracking-tight text-foreground",
		fontFamily: "DM Sans",
		weight: "600",
		size: "30px",
		lineHeight: "36px",
		letterSpacing: "-0.025em",
		sampleText: "Audio Processing",
	},
	{
		name: "Heading",
		className: "text-xl font-semibold tracking-tight text-foreground",
		fontFamily: "DM Sans",
		weight: "600",
		size: "20px",
		lineHeight: "28px",
		letterSpacing: "-0.025em",
		sampleText: "Processing Chain",
	},
	{
		name: "Subheading",
		className: "text-sm font-medium tracking-wide text-foreground",
		fontFamily: "DM Sans",
		weight: "500",
		size: "14px",
		lineHeight: "20px",
		letterSpacing: "0.025em",
		sampleText: "Transform Parameters",
	},
	{
		name: "Body",
		className: "text-sm text-foreground",
		fontFamily: "DM Sans",
		weight: "400",
		size: "14px",
		lineHeight: "20px",
		letterSpacing: "0",
		sampleText: "Configure the processing chain by adding and ordering transform modules.",
	},
	{
		name: "Caption",
		className: "text-xs text-muted-foreground",
		fontFamily: "DM Sans",
		weight: "400",
		size: "12px",
		lineHeight: "16px",
		letterSpacing: "0",
		sampleText: "Last modified 2 hours ago",
	},
	{
		name: "Data",
		className: "font-mono text-sm tabular-nums text-foreground",
		fontFamily: "JetBrains Mono",
		weight: "400",
		size: "14px",
		lineHeight: "20px",
		letterSpacing: "0",
		sampleText: "-14.2 LUFS | -1.0 dBTP | 7.4 LRA",
	},
	{
		name: "Data Small",
		className: "font-mono text-xs tabular-nums text-foreground",
		fontFamily: "JetBrains Mono",
		weight: "400",
		size: "12px",
		lineHeight: "16px",
		letterSpacing: "0",
		sampleText: "00:03:24.816 48000 Hz 24-bit",
	},
	{
		name: "Label Mono",
		className: "font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground",
		fontFamily: "JetBrains Mono",
		weight: "400",
		size: "10px",
		lineHeight: "14px",
		letterSpacing: "0.2em",
		sampleText: "FREQUENCY RESPONSE",
	},
];

function TypeRow({ level }: { level: TypeLevel }) {
	return (
		<div className="grid grid-cols-[140px_1fr] items-baseline gap-6 border-b border-border/50 py-4 last:border-0">
			<div className="space-y-1">
				<span className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					{level.name}
				</span>
				<div className="space-y-0.5 font-mono text-[0.625rem] text-muted-foreground/70">
					<div>{level.fontFamily}</div>
					<div>{level.weight} / {level.size} / {level.lineHeight}</div>
					{level.letterSpacing !=="0" && <div>ls: {level.letterSpacing}</div>}
				</div>
			</div>
			<div className={level.className}>
				{level.sampleText}
			</div>
		</div>
	);
}

function PairingDemo() {
	return (
		<div className="card-outline p-5">
			<h4 className="mb-4 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Pairing in Context
			</h4>
			<div className="space-y-3">
				<div className="text-sm font-medium tracking-wide text-foreground">Loudness Analysis</div>
				<div className="grid grid-cols-3 gap-4">
					<div className="space-y-1">
						<span className="font-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground">
							Integrated
						</span>
						<div className="font-mono text-lg tabular-nums text-foreground">-14.2</div>
						<div className="font-mono text-[0.625rem] text-muted-foreground">LUFS</div>
					</div>
					<div className="space-y-1">
						<span className="font-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground">
							True Peak
						</span>
						<div className="font-mono text-lg tabular-nums text-foreground">-1.0</div>
						<div className="font-mono text-[0.625rem] text-muted-foreground">dBTP</div>
					</div>
					<div className="space-y-1">
						<span className="font-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground">
							Range
						</span>
						<div className="font-mono text-lg tabular-nums text-foreground">7.4</div>
						<div className="font-mono text-[0.625rem] text-muted-foreground">LU</div>
					</div>
				</div>
			</div>
		</div>
	);
}

export function Typography() {
	return (
		<div className="space-y-8">
			<div>
				<h4 className="mb-1 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Font Stack
				</h4>
				<div className="space-y-2">
					<div className="flex items-baseline gap-3">
						<span className="w-16 font-mono text-[0.625rem] text-muted-foreground">UI</span>
						<span className="text-sm font-medium text-foreground">DM Sans</span>
						<span className="text-xs text-muted-foreground">
							Geometric sans-serif. Clean, precise, engineered feel.
						</span>
					</div>
					<div className="flex items-baseline gap-3">
						<span className="w-16 font-mono text-[0.625rem] text-muted-foreground">Data</span>
						<span className="font-mono text-sm font-medium text-foreground">JetBrains Mono</span>
						<span className="text-xs text-muted-foreground">
							Technical mono. Clear digit differentiation, tabular figures.
						</span>
					</div>
				</div>
			</div>
			<div className="h-px bg-border" />
			<div>
				<h4 className="mb-4 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Type Scale
				</h4>
				{TYPE_SCALE.map((level) => (
					<TypeRow key={level.name} level={level} />
				))}
			</div>
			<PairingDemo />
		</div>
	);
}
