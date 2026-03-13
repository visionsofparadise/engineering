interface InstrumentReadoutProps {
	label: string;
	value: string;
	unit?: string;
	valueClassName?: string;
}

export function InstrumentReadout({ label, value, unit, valueClassName }: InstrumentReadoutProps) {
	return (
		<div className="flex flex-1 flex-col items-center px-6 py-3">
			<span className="font-mono text-[0.5625rem] uppercase tracking-[0.15em] text-muted-foreground">
				{label}
			</span>
			<span className={valueClassName ?? "mt-1.5 font-mono text-lg tabular-nums leading-none text-foreground"}>
				{value}
			</span>
			{unit ? (
				<span className="mt-1 font-mono text-[0.625rem] text-muted-foreground">
					{unit}
				</span>
			) : null}
		</div>
	);
}

interface InstrumentPanelProps {
	children: React.ReactNode;
}

export function InstrumentPanel({ children }: InstrumentPanelProps) {
	return (
		<div className="card-outline">
			<div className="flex items-center justify-between divide-x divide-border">
				{children}
			</div>
		</div>
	);
}
