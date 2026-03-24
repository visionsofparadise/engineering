import { cn } from "../utils/cn";

const SECTIONS = [
	{ id: "foundations", label: "Foundations" },
	{ id: "components", label: "Components" },
	{ id: "workspace", label: "Workspace" },
	{ id: "processing", label: "Processing" },
	{ id: "modals", label: "Modals" },
	{ id: "theme", label: "Theme" },
] as const;

interface NavigationProps {
	activeSection: string;
	onSectionChange: (section: string) => void;
}

export function Navigation({ activeSection, onSectionChange }: NavigationProps) {
	return (
		<nav className="flex flex-col gap-0.5 px-3 py-4">
			<span className="mb-3 px-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Sections
			</span>
			{SECTIONS.map((section) => (
				<button
					key={section.id}
					onClick={() => onSectionChange(section.id)}
					className={cn(
						"px-3 py-2 text-left font-mono text-xs tracking-wide transition-all",
						"hover:bg-accent hover:text-accent-foreground",
						activeSection === section.id
							? "surface-control-pressed text-foreground"
							: "text-muted-foreground",
					)}
				>
					{section.label}
				</button>
			))}
		</nav>
	);
}
