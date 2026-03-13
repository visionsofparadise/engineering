interface SurfaceSample {
	name: string;
	description: string;
	usage: string;
	surfaceClass: string;
}

const PANEL_SURFACES: Array<SurfaceSample> = [
	{
		name: "Panel",
		description: "Flat matte surface for structural areas. The faceplate — what holds everything together.",
		usage: "Sidebar, instrument panels, structural containers",
		surfaceClass: "surface-panel",
	},
	{
		name: "Panel Header",
		description: "Slightly darker/lighter panel variant with bottom border. Distinguishes header regions from body.",
		usage: "Sidebar header, section headers, nameplates",
		surfaceClass: "surface-panel-header",
	},
];

const CONTROL_SURFACES: Array<SurfaceSample> = [
	{
		name: "Control (raised)",
		description: "Flat matte surface 2-4% lighter/darker than panel. Reads as a control through shadow, not gradient.",
		usage: "Secondary buttons, select triggers, file inputs, active tabs",
		surfaceClass: "surface-control",
	},
	{
		name: "Control (pressed)",
		description: "Recessed surface for active/engaged states. Inset shadow communicates depression.",
		usage: "Active nav items, pressed toggles, engaged controls",
		surfaceClass: "surface-control-pressed",
	},
	{
		name: "Primary",
		description: "Same as control but with a 2px accent-colored bottom border. Color identifies importance, not fills the surface.",
		usage: "Primary buttons, primary actions",
		surfaceClass: "surface-primary",
	},
];

const WELL_SURFACES: Array<SurfaceSample> = [
	{
		name: "Channel",
		description: "Deeply recessed well with heavy inset shadow. The slot that controls sit in.",
		usage: "Input fields, slider tracks, tab strip housings, theme toggle housing",
		surfaceClass: "surface-channel",
	},
	{
		name: "Instrument Panel",
		description: "Lightly recessed panel with subtle inset shadow. For data readouts and stat displays.",
		usage: "Readout panels, metadata displays",
		surfaceClass: "surface-instrument-panel",
	},
];

const SPECIALIZED_SURFACES: Array<SurfaceSample> = [
	{
		name: "Slider Range",
		description: "Flat accent fill for the active portion of a slider track. One of the few places color is used as a fill.",
		usage: "Slider active range",
		surfaceClass: "surface-slider-range",
	},
];

function SurfaceSection({ title, description, samples }: { title: string; description: string; samples: Array<SurfaceSample> }) {
	return (
		<div>
			<h4 className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				{title}
			</h4>
			<p className="mb-4 text-[0.6875rem] text-muted-foreground">
				{description}
			</p>
			<div className="space-y-4">
				{samples.map((sample) => (
					<div key={sample.name} className="flex items-start gap-4">
						<div className={`mt-0.5 h-14 w-24 shrink-0 ${sample.surfaceClass}`} />
						<div className="min-w-0">
							<span className="block font-mono text-xs font-medium text-foreground">
								{sample.name}
							</span>
							<span className="mt-1 block text-[0.6875rem] text-muted-foreground">{sample.description}</span>
							<span className="mt-1 block text-[0.625rem] text-muted-foreground/70">
								Used for: {sample.usage}
							</span>
							<span className="mt-1 block font-mono text-[0.5625rem] text-muted-foreground/50">
								class: .{sample.surfaceClass}
							</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

function DepthSystem() {
	const shadows = [
		{ name: "--shadow-raised", description: "Default elevation for controls", preview: "shadow-raised" },
		{ name: "--shadow-raised-hover", description: "Hover state — slightly more lift", preview: "shadow-raised-hover" },
		{ name: "--shadow-pressed", description: "Inset depression for active states", preview: "shadow-pressed" },
		{ name: "--shadow-channel", description: "Deep inset for recessed wells", preview: "shadow-channel" },
		{ name: "--shadow-panel-inset", description: "Subtle inset for readout panels", preview: "shadow-panel-inset" },
	];

	return (
		<div>
			<h4 className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Depth System — Shadow Catalog
			</h4>
			<p className="mb-4 text-[0.6875rem] text-muted-foreground">
				All depth is communicated through shadow. Raised = drop shadow. Pressed = inset shadow. Recessed = deep inset. No gradients simulate curvature.
			</p>
			<div className="grid grid-cols-3 gap-3">
				{shadows.map((s) => (
					<div key={s.name} className="card-outline p-3">
						<div
							className="mx-auto mb-3 h-8 w-16 bg-muted"
							style={{ boxShadow: `var(${s.name})` }}
						/>
						<span className="block font-mono text-[0.5625rem] text-foreground">{s.name}</span>
						<span className="block text-[0.625rem] text-muted-foreground">{s.description}</span>
					</div>
				))}
			</div>
		</div>
	);
}

function AccentSystem() {
	return (
		<div>
			<h4 className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Accent System — Color as Indicator
			</h4>
			<p className="mb-4 text-[0.6875rem] text-muted-foreground">
				The primary color (copper, hue 28) is never used as a surface fill on controls. It appears only as thin indicators: a 2px bottom border on primary buttons and the slider range fill.
			</p>
			<div className="space-y-3">
				<div className="flex items-center gap-4">
					<div className="surface-primary h-10 w-32 shrink-0" />
					<div>
						<span className="block font-mono text-xs text-foreground">Primary action</span>
						<span className="block text-[0.6875rem] text-muted-foreground">2px accent border-bottom identifies importance</span>
					</div>
				</div>
				<div className="flex items-center gap-4">
					<div className="surface-slider-range h-2 w-32 shrink-0" />
					<div>
						<span className="block font-mono text-xs text-foreground">Slider range fill</span>
						<span className="block text-[0.6875rem] text-muted-foreground">One of the few places accent color fills a surface</span>
					</div>
				</div>
			</div>
		</div>
	);
}

function DesignGuidelines() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Design Guidelines
			</h4>
			<div className="space-y-4">
				<div className="card-outline p-4">
					<div className="space-y-3 text-[0.6875rem] text-muted-foreground">
						<div>
							<span className="font-mono text-xs text-foreground">No gradients on surfaces</span>
							<p className="mt-1">All surfaces are flat solid colors. Depth is communicated exclusively through shadow — raised, pressed, and recessed states.</p>
						</div>
						<div>
							<span className="font-mono text-xs text-foreground">Color as indicator, never as fill</span>
							<p className="mt-1">The primary accent color appears only as: thin border-bottom accents (2px) and slider range fills. Never as a button surface color.</p>
						</div>
						<div>
							<span className="font-mono text-xs text-foreground">Minimal contrast between surface and control</span>
							<p className="mt-1">Controls are 2-4% lightness different from their panel. Just enough to see the boundary. The shadow does the rest.</p>
						</div>
						<div>
							<span className="font-mono text-xs text-foreground">Restraint is premium</span>
							<p className="mt-1">The aesthetic comes from how little is happening. Dark matte surfaces that recede. Controls identified by shadow and shape, not by dramatic material differences.</p>
						</div>
					</div>
				</div>

				<div className="card-outline p-4">
					<span className="mb-2 block font-mono text-[0.625rem] uppercase tracking-[0.15em] text-muted-foreground">
						Surface class reference
					</span>
					<div className="mt-2 flex flex-wrap gap-2 text-[0.6875rem]">
						<span className="bg-muted px-2 py-1 text-foreground">.surface-panel (structural areas)</span>
						<span className="bg-muted px-2 py-1 text-foreground">.surface-panel-header (header bars)</span>
						<span className="bg-muted px-2 py-1 text-foreground">.surface-channel (input wells, tracks)</span>
						<span className="bg-muted px-2 py-1 text-foreground">.surface-control (buttons, selects)</span>
						<span className="bg-muted px-2 py-1 text-foreground">.surface-control-pressed (active states)</span>
						<span className="bg-muted px-2 py-1 text-foreground">.surface-primary (primary actions)</span>
						<span className="bg-muted px-2 py-1 text-foreground">.surface-slider-range (slider fill)</span>
						<span className="bg-muted px-2 py-1 text-foreground">.card-outline (section dividers)</span>
					</div>
				</div>
			</div>
		</div>
	);
}

function CardTypes() {
	return (
		<div>
			<h4 className="mb-2 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Card Types
			</h4>
			<p className="mb-4 text-[0.6875rem] text-muted-foreground">
				Two ways to group content. Surface cards are elevated containers. Outline cards are section dividers printed on the same surface — like silkscreened groupings on a mixer faceplate.
			</p>
			<div className="grid grid-cols-2 gap-6">
				<div>
					<span className="mb-2 block font-mono text-[0.625rem] text-muted-foreground">Surface Card</span>
					<div className="border border-border bg-card p-4">
						<span className="block text-sm text-foreground">Elevated container</span>
						<span className="mt-1 block text-[0.6875rem] text-muted-foreground">Has background fill and shadow. Sits above the page surface.</span>
					</div>
				</div>
				<div>
					<span className="mb-2 block font-mono text-[0.625rem] text-muted-foreground">Outline Card</span>
					<div className="card-outline p-4">
						<span className="block text-sm text-foreground">Section divider</span>
						<span className="mt-1 block text-[0.6875rem] text-muted-foreground">No background, no shadow. Just a border on the same surface. Like printed outlines on a mixer.</span>
					</div>
				</div>
			</div>
		</div>
	);
}

export function Materials() {
	return (
		<div className="space-y-8">
			<CardTypes />

			<div className="h-px bg-border" />

			<SurfaceSection
				title="Panel Surfaces"
				description="Flat matte backgrounds for structural areas. The chassis — what holds everything together. Dark in dark mode, light in light mode. No gradients, no sheen."
				samples={PANEL_SURFACES}
			/>

			<div className="h-px bg-border" />

			<SurfaceSection
				title="Control Surfaces"
				description="Interactive elements differentiated by subtle shade and shadow. Controls are barely distinguishable from the panel they sit on — just enough contrast to see boundaries."
				samples={CONTROL_SURFACES}
			/>

			<div className="h-px bg-border" />

			<SurfaceSection
				title="Recessed Wells"
				description="Inset areas where controls sit and data flows. Depth communicated by inset shadow, not color."
				samples={WELL_SURFACES}
			/>

			<div className="h-px bg-border" />

			<SurfaceSection
				title="Specialized"
				description="Purpose-built surfaces for specific controls."
				samples={SPECIALIZED_SURFACES}
			/>

			<div className="h-px bg-border" />

			<DepthSystem />

			<div className="h-px bg-border" />

			<AccentSystem />

			<div className="h-px bg-border" />

			<DesignGuidelines />
		</div>
	);
}
