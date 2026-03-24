import { Loader2, ChevronRight, Plus, Download } from "lucide-react";
import { Button } from "../../components/ui/button";

function VariantShowcase() {
	const variants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;

	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Variants
			</h4>
			<div className="flex flex-wrap items-center gap-3">
				{variants.map((variant) => (
					<Button key={variant} variant={variant}>
						{variant.charAt(0).toUpperCase() + variant.slice(1)}
					</Button>
				))}
			</div>
		</div>
	);
}

function SizeShowcase() {
	const sizes = [
		{ size: "sm" as const, label: "Small" },
		{ size: "default" as const, label: "Default" },
		{ size: "lg" as const, label: "Large" },
		{ size: "icon" as const, label: "+" },
	];

	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Sizes
			</h4>
			<div className="flex flex-wrap items-center gap-3">
				{sizes.map((item) => (
					<Button key={item.size} size={item.size}>
						{item.label}
					</Button>
				))}
			</div>
		</div>
	);
}

function StateShowcase() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				States
			</h4>
			<div className="flex flex-wrap items-center gap-3">
				<Button>Default</Button>
				<Button disabled>Disabled</Button>
				<Button disabled>
					<Loader2 className="animate-spin" />
					Loading
				</Button>
			</div>
		</div>
	);
}

function WithIconsShowcase() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				With Icons
			</h4>
			<div className="flex flex-wrap items-center gap-3">
				<Button>
					<Plus />
					Add Module
				</Button>
				<Button variant="outline">
					<Download />
					Export
				</Button>
				<Button variant="secondary">
					Continue
					<ChevronRight />
				</Button>
				<Button size="icon" variant="outline">
					<Plus />
				</Button>
			</div>
		</div>
	);
}

function ToolbarPattern() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Toolbar Pattern
			</h4>
			<div className="inline-flex border border-border">
				<Button variant="ghost" size="sm" className="border-r border-border">
					Cut
				</Button>
				<Button variant="ghost" size="sm" className="border-r border-border">
					Copy
				</Button>
				<Button variant="ghost" size="sm">
					Paste
				</Button>
			</div>
		</div>
	);
}

export function Buttons() {
	return (
		<div className="space-y-8">
			<VariantShowcase />
			<SizeShowcase />
			<StateShowcase />
			<WithIconsShowcase />
			<ToolbarPattern />
		</div>
	);
}
