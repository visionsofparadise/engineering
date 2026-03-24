import { cn } from "../../utils/cn";

interface SpacingStep {
	px: number;
	tailwind: string;
	rem: string;
}

const SPACING_SCALE: Array<SpacingStep> = [
	{ px: 1, tailwind: "px", rem: "0.0625" },
	{ px: 2, tailwind: "0.5", rem: "0.125" },
	{ px: 4, tailwind: "1", rem: "0.25" },
	{ px: 8, tailwind: "2", rem: "0.5" },
	{ px: 12, tailwind: "3", rem: "0.75" },
	{ px: 16, tailwind: "4", rem: "1" },
	{ px: 24, tailwind: "6", rem: "1.5" },
	{ px: 32, tailwind: "8", rem: "2" },
	{ px: 48, tailwind: "12", rem: "3" },
	{ px: 64, tailwind: "16", rem: "4" },
];

function SpacingRow({ step }: { step: SpacingStep }) {
	return (
		<div className="flex items-center gap-4">
			<span className="w-12 text-right font-mono text-xs tabular-nums text-foreground">
				{step.px}px
			</span>
			<div className="flex-1">
				<div
					className="h-3 rounded-[1px] bg-primary/60"
					style={{ width: `${step.px}px` }}
				/>
			</div>
			<span className="w-14 font-mono text-[0.625rem] tabular-nums text-muted-foreground">
				{step.rem}rem
			</span>
			<span className="w-10 font-mono text-[0.625rem] text-muted-foreground">
				{step.tailwind}
			</span>
		</div>
	);
}

function GridDemo() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				4px Base Grid
			</h4>
			<div className="relative h-32 overflow-hidden card-outline">
				<div
					className="absolute inset-0 opacity-10"
					style={{
						backgroundImage: `
							linear-gradient(var(--color-foreground) 1px, transparent 1px),
							linear-gradient(90deg, var(--color-foreground) 1px, transparent 1px)
						`,
						backgroundSize: "4px 4px",
					}}
				/>
				<div className="relative flex items-start gap-2 p-4">
					<div className="h-8 w-20 bg-primary/20 border border-primary/30" />
					<div className="h-8 w-20 bg-primary/20 border border-primary/30" />
				</div>
				<div className="relative px-4">
					<div className="h-10 w-48 bg-secondary border border-border" />
				</div>
			</div>
			<p className="mt-2 text-[0.625rem] text-muted-foreground">
				All spacing, sizing, and positioning align to a 4px grid.
			</p>
		</div>
	);
}

function ComponentSpacing() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Component Spacing Examples
			</h4>
			<div className="space-y-4 card-outline p-5">
				<div>
					<span className="font-mono text-[0.625rem] text-muted-foreground">Button gap: 8px (2)</span>
					<div className="mt-2 flex gap-2">
						<div className="h-9 w-20 bg-primary" />
						<div className="h-9 w-20 bg-secondary border border-border" />
					</div>
				</div>
				<div>
					<span className="font-mono text-[0.625rem] text-muted-foreground">Card padding: 24px (6)</span>
					<div className={cn("mt-2 border border-border p-6")}>
						<div className="h-4 w-32 bg-foreground/10" />
					</div>
				</div>
				<div>
					<span className="font-mono text-[0.625rem] text-muted-foreground">Section margin: 32px (8)</span>
					<div className="mt-2 space-y-8">
						<div className="h-4 w-48 bg-foreground/10" />
						<div className="h-4 w-48 bg-foreground/10" />
					</div>
				</div>
			</div>
		</div>
	);
}

export function Spacing() {
	return (
		<div className="space-y-8">
			<div>
				<h4 className="mb-4 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Spacing Scale
				</h4>
				<div className="space-y-2">
					{SPACING_SCALE.map((step) => (
						<SpacingRow key={step.px} step={step} />
					))}
				</div>
			</div>
			<div className="h-px bg-border" />
			<GridDemo />
			<ComponentSpacing />
		</div>
	);
}
