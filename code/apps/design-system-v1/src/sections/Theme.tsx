import { useTheme } from "../components/ThemeProvider";

interface CssVariableEntry {
	variable: string;
	lightValue: string;
	darkValue: string;
	purpose: string;
}

const CSS_VARIABLES: Array<CssVariableEntry> = [
	{ variable: "--background", lightValue: "hsl(18 12% 99%)", darkValue: "hsl(18 8% 10%)", purpose: "Page background" },
	{ variable: "--foreground", lightValue: "hsl(18 6% 6%)", darkValue: "hsl(18 8% 96%)", purpose: "Primary text color" },
	{ variable: "--card", lightValue: "hsl(18 8% 97.5%)", darkValue: "hsl(18 6% 13%)", purpose: "Card surface" },
	{ variable: "--popover", lightValue: "hsl(18 8% 97.5%)", darkValue: "hsl(18 6% 13%)", purpose: "Popover surface" },
	{ variable: "--primary", lightValue: "hsl(28 45% 42%)", darkValue: "hsl(28 45% 46%)", purpose: "Primary actions (copper)" },
	{ variable: "--secondary", lightValue: "hsl(18 10% 94%)", darkValue: "hsl(18 8% 15%)", purpose: "Secondary actions" },
	{ variable: "--accent", lightValue: "hsl(18 8% 94%)", darkValue: "hsl(18 8% 15%)", purpose: "Hover highlights" },
	{ variable: "--destructive", lightValue: "hsl(0 84.2% 60.2%)", darkValue: "hsl(0 62.8% 30.6%)", purpose: "Destructive actions" },
	{ variable: "--muted", lightValue: "hsl(18 8% 94.5%)", darkValue: "hsl(18 8% 15%)", purpose: "Subdued backgrounds" },
	{ variable: "--muted-foreground", lightValue: "hsl(18 5% 46%)", darkValue: "hsl(18 6% 55%)", purpose: "Secondary text" },
	{ variable: "--border", lightValue: "hsl(18 10% 88%)", darkValue: "hsl(18 8% 16%)", purpose: "Borders, dividers" },
	{ variable: "--input", lightValue: "hsl(18 10% 88%)", darkValue: "hsl(18 8% 16%)", purpose: "Input borders" },
	{ variable: "--ring", lightValue: "hsl(28 45% 42%)", darkValue: "hsl(28 45% 50%)", purpose: "Focus rings (copper)" },
	{ variable: "--status-queued", lightValue: "hsl(18 5% 56%)", darkValue: "hsl(18 6% 50%)", purpose: "Queued/pending state" },
	{ variable: "--status-processing", lightValue: "hsl(210 80% 52%)", darkValue: "hsl(210 80% 60%)", purpose: "Active processing" },
	{ variable: "--status-complete", lightValue: "hsl(152 60% 40%)", darkValue: "hsl(152 60% 50%)", purpose: "Completed successfully" },
	{ variable: "--status-error", lightValue: "hsl(0 72% 51%)", darkValue: "hsl(0 72% 58%)", purpose: "Error/failure state" },
	{ variable: "--status-warning", lightValue: "hsl(38 92% 50%)", darkValue: "hsl(38 92% 55%)", purpose: "Warning/caution state" },
	{ variable: "--surface-panel", lightValue: "hsl(18 6% 92%)", darkValue: "hsl(18 4% 10%)", purpose: "Panel backgrounds" },
	{ variable: "--surface-control", lightValue: "hsl(18 4% 86%)", darkValue: "hsl(18 3% 16%)", purpose: "Raised controls" },
	{ variable: "--fader-thumb", lightValue: "hsl(18 4% 72%)", darkValue: "hsl(18 3% 18%)", purpose: "Fader cap color" },
	{ variable: "--slider-range", lightValue: "hsl(28 50% 48%)", darkValue: "hsl(28 45% 46%)", purpose: "Slider active fill" },
	{ variable: "--playhead", lightValue: "hsl(0 80% 50%)", darkValue: "hsl(0 80% 55%)", purpose: "Playback position" },
	{ variable: "--accent-border", lightValue: "hsl(28 45% 42%)", darkValue: "hsl(28 45% 46%)", purpose: "Primary button accent" },
];

function ThemeComparison() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Side-by-Side Comparison
			</h4>
			<div className="grid grid-cols-2 gap-4">
				<div className="light border border-border bg-background p-4 text-foreground">
					<span className="mb-2 block font-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground">
						Light Mode
					</span>
					<div className="space-y-2">
						<div className="surface-primary h-8 px-3 py-1.5 text-xs text-foreground">
							Primary Button
						</div>
						<div className="h-6 border border-input bg-background px-2 py-1 font-mono text-[0.625rem] text-foreground">
							input field
						</div>
						<div className="font-mono text-[0.625rem] text-muted-foreground">
							-14.2 LUFS | -1.0 dBTP
						</div>
					</div>
				</div>

				<div className="dark border border-border bg-background p-4 text-foreground">
					<span className="mb-2 block font-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground">
						Dark Mode
					</span>
					<div className="space-y-2">
						<div className="surface-primary h-8 px-3 py-1.5 text-xs text-foreground">
							Primary Button
						</div>
						<div className="h-6 border border-input bg-background px-2 py-1 font-mono text-[0.625rem] text-foreground">
							input field
						</div>
						<div className="font-mono text-[0.625rem] text-muted-foreground">
							-14.2 LUFS | -1.0 dBTP
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}

function VariableTable() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				CSS Variable Reference
			</h4>
			<div className="overflow-x-auto border border-border">
				<table className="w-full text-left">
					<thead>
						<tr className="border-b border-border bg-muted">
							<th className="px-3 py-2 font-mono text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
								Variable
							</th>
							<th className="px-3 py-2 font-mono text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
								Light
							</th>
							<th className="px-3 py-2 font-mono text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
								Dark
							</th>
							<th className="px-3 py-2 font-mono text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
								Purpose
							</th>
						</tr>
					</thead>
					<tbody>
						{CSS_VARIABLES.map((entry) => (
							<tr key={entry.variable} className="border-b border-border/50 last:border-0">
								<td className="px-3 py-1.5 font-mono text-[0.625rem] text-foreground">{entry.variable}</td>
								<td className="px-3 py-1.5">
									<div className="flex items-center gap-2">
										<div
											className="h-3 w-3 border border-border"
											style={{ backgroundColor: entry.lightValue }}
										/>
										<span className="font-mono text-[0.5625rem] text-muted-foreground">{entry.lightValue}</span>
									</div>
								</td>
								<td className="px-3 py-1.5">
									<div className="flex items-center gap-2">
										<div
											className="h-3 w-3 border border-border"
											style={{ backgroundColor: entry.darkValue }}
										/>
										<span className="font-mono text-[0.5625rem] text-muted-foreground">{entry.darkValue}</span>
									</div>
								</td>
								<td className="px-3 py-1.5 text-[0.6875rem] text-muted-foreground">{entry.purpose}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

function ExtensionGuide() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Adding New Tokens
			</h4>
			<div className="card-outline p-4 text-xs text-muted-foreground">
				<ol className="list-inside list-decimal space-y-2">
					<li>Add the CSS variable to <code className="font-mono text-[0.625rem] text-foreground">:root</code> in <code className="font-mono text-[0.625rem] text-foreground">@layer base</code> in <code className="font-mono text-[0.625rem] text-foreground">index.css</code></li>
					<li>Add the dark mode override in the <code className="font-mono text-[0.625rem] text-foreground">.dark</code> block</li>
					<li>Map it in <code className="font-mono text-[0.625rem] text-foreground">@theme inline</code> as <code className="font-mono text-[0.625rem] text-foreground">--color-[name]: var(--[name])</code></li>
					<li>Tailwind v4 generates utilities from <code className="font-mono text-[0.625rem] text-foreground">--color-*</code>: use as <code className="font-mono text-[0.625rem] text-foreground">bg-[name]</code>, <code className="font-mono text-[0.625rem] text-foreground">text-[name]</code>, <code className="font-mono text-[0.625rem] text-foreground">border-[name]</code></li>
				</ol>
			</div>
		</div>
	);
}

export function Theme() {
	const { theme } = useTheme();

	return (
		<div className="space-y-8">
			<div>
				<h4 className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Current Theme
				</h4>
				<div className="flex items-center gap-3">
					<span className="font-mono text-sm text-foreground">{theme}</span>
					<span className="text-xs text-muted-foreground">
						Use the toggle in the sidebar header to switch themes.
					</span>
				</div>
			</div>
			<div className="h-px bg-border" />
			<ThemeComparison />
			<VariableTable />
			<ExtensionGuide />
		</div>
	);
}
