import { cn } from "../../utils/cn";

interface ColorToken {
	name: string;
	variable: string;
	twClass: string;
	usage: string;
}

const SURFACE_TOKENS: Array<ColorToken> = [
	{ name: "Background", variable: "--color-background", twClass: "bg-background", usage: "Page background" },
	{ name: "Foreground", variable: "--color-foreground", twClass: "bg-foreground", usage: "Primary text" },
	{ name: "Card", variable: "--color-card", twClass: "bg-card", usage: "Card surfaces" },
	{ name: "Card Foreground", variable: "--color-card-foreground", twClass: "bg-card-foreground", usage: "Text on cards" },
	{ name: "Popover", variable: "--color-popover", twClass: "bg-popover", usage: "Popover surfaces" },
	{ name: "Popover Foreground", variable: "--color-popover-foreground", twClass: "bg-popover-foreground", usage: "Text in popovers" },
];

const INTERACTIVE_TOKENS: Array<ColorToken> = [
	{ name: "Primary", variable: "--color-primary", twClass: "bg-primary", usage: "Primary actions, emphasis" },
	{ name: "Primary Foreground", variable: "--color-primary-foreground", twClass: "bg-primary-foreground", usage: "Text on primary" },
	{ name: "Secondary", variable: "--color-secondary", twClass: "bg-secondary", usage: "Secondary actions" },
	{ name: "Secondary Foreground", variable: "--color-secondary-foreground", twClass: "bg-secondary-foreground", usage: "Text on secondary" },
	{ name: "Accent", variable: "--color-accent", twClass: "bg-accent", usage: "Hover states, highlights" },
	{ name: "Accent Foreground", variable: "--color-accent-foreground", twClass: "bg-accent-foreground", usage: "Text on accent" },
	{ name: "Destructive", variable: "--color-destructive", twClass: "bg-destructive", usage: "Destructive actions, errors" },
	{ name: "Destructive Foreground", variable: "--color-destructive-foreground", twClass: "bg-destructive-foreground", usage: "Text on destructive" },
];

const UTILITY_TOKENS: Array<ColorToken> = [
	{ name: "Muted", variable: "--color-muted", twClass: "bg-muted", usage: "Subdued backgrounds" },
	{ name: "Muted Foreground", variable: "--color-muted-foreground", twClass: "bg-muted-foreground", usage: "Secondary text" },
	{ name: "Border", variable: "--color-border", twClass: "bg-border", usage: "Borders, dividers" },
	{ name: "Input", variable: "--color-input", twClass: "bg-input", usage: "Form input borders" },
	{ name: "Ring", variable: "--color-ring", twClass: "bg-ring", usage: "Focus rings" },
];

interface StatusColor {
	name: string;
	tailwind: string;
	usage: string;
}

const STATUS_COLORS: Array<StatusColor> = [
	{ name: "Queued", tailwind: "bg-status-queued", usage: "Pending jobs" },
	{ name: "Processing", tailwind: "bg-status-processing", usage: "Active operations" },
	{ name: "Complete", tailwind: "bg-status-complete", usage: "Successful completion" },
	{ name: "Error", tailwind: "bg-status-error", usage: "Failures, errors" },
	{ name: "Warning", tailwind: "bg-status-warning", usage: "Caution states" },
];

const DATA_COLORS: Array<StatusColor> = [
	{ name: "Waveform", tailwind: "bg-sky-400", usage: "Audio waveform signal" },
	{ name: "Selection", tailwind: "bg-blue-500/30", usage: "Time range selection overlay" },
	{ name: "Playhead", tailwind: "bg-primary", usage: "Playback position indicator" },
];

function ColorSwatch({ token }: { token: ColorToken }) {
	return (
		<div className="flex items-start gap-3">
			<div
				className={cn(
					"mt-0.5 h-10 w-10 shrink-0",
					"bg-[repeating-conic-gradient(rgba(128,128,128,0.15)_0%_25%,transparent_0%_50%)] bg-[length:8px_8px]",
				)}
			>
				<div className={cn("h-full w-full", token.twClass)} />
			</div>
			<div className="min-w-0">
				<span className="block font-mono text-xs text-foreground">{token.name}</span>
				<span className="block font-mono text-[0.625rem] text-muted-foreground">{token.variable}</span>
				<span className="block text-[0.625rem] text-muted-foreground">{token.usage}</span>
			</div>
		</div>
	);
}

function StatusSwatch({ color }: { color: StatusColor }) {
	return (
		<div className="flex items-center gap-3">
			<div className={cn("h-8 w-8 shrink-0", color.tailwind)} />
			<div className="min-w-0">
				<span className="block font-mono text-xs text-foreground">{color.name}</span>
				<span className="block text-[0.625rem] text-muted-foreground">{color.usage}</span>
			</div>
		</div>
	);
}

function TokenGroup({ title, tokens }: { title: string; tokens: Array<ColorToken> }) {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				{title}
			</h4>
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
				{tokens.map((token) => (
					<ColorSwatch key={token.variable} token={token} />
				))}
			</div>
		</div>
	);
}

function StatusGroup({ title, colors }: { title: string; colors: Array<StatusColor> }) {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				{title}
			</h4>
			<div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
				{colors.map((color) => (
					<StatusSwatch key={color.name} color={color} />
				))}
			</div>
		</div>
	);
}

function ColormapStrip({ title, stops }: { title: string; stops: Array<string> }) {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				{title}
			</h4>
			<div
				className="h-8"
				style={{
					background: `linear-gradient(to right, ${stops.join(", ")})`,
				}}
			/>
			<div className="mt-1 flex justify-between font-mono text-[0.625rem] text-muted-foreground">
				<span>-80 dB</span>
				<span>0 dB</span>
			</div>
		</div>
	);
}

function ColormapStrips() {
	const viridisStops = [
		"#440154", "#482878", "#3e4989", "#31688e", "#26828e",
		"#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725",
	];
	const lavaStops = [
		"#000000", "#280000", "#640800", "#a01400", "#c82800",
		"#dc5014", "#f08c14", "#fcc83c", "#fff08c", "#ffffff",
	];

	return (
		<div className="space-y-6">
			<ColormapStrip title="Spectrogram — Viridis" stops={viridisStops} />
			<ColormapStrip title="Spectrogram — Lava" stops={lavaStops} />
		</div>
	);
}

export function Colors() {
	return (
		<div className="space-y-8">
			<TokenGroup title="Surfaces" tokens={SURFACE_TOKENS} />
			<TokenGroup title="Interactive" tokens={INTERACTIVE_TOKENS} />
			<TokenGroup title="Utility" tokens={UTILITY_TOKENS} />
			<div className="h-px bg-border" />
			<StatusGroup title="Status" colors={STATUS_COLORS} />
			<StatusGroup title="Data Visualization" colors={DATA_COLORS} />
			<ColormapStrips />
		</div>
	);
}
