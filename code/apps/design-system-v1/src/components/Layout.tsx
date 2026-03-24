import { useState } from "react";
import { Moon, Sun, Monitor } from "lucide-react";
import { Navigation } from "./Navigation";
import { useTheme } from "./ThemeProvider";
import { Foundations } from "../sections/Foundations";
import { Components } from "../sections/Components";
import { Workspace } from "../sections/Workspace";
import { ProcessingSection } from "../sections/ProcessingSection";
import { Modals } from "../sections/Modals";
import { Theme } from "../sections/Theme";
import { cn } from "../utils/cn";

function ThemeToggle() {
	const { theme, setTheme } = useTheme();

	const options = [
		{ value: "light" as const, icon: Sun, label: "Light" },
		{ value: "dark" as const, icon: Moon, label: "Dark" },
		{ value: "system" as const, icon: Monitor, label: "System" },
	];

	return (
		<div className="surface-channel flex gap-0.5 p-0.5">
			{options.map((option) => (
				<button
					key={option.value}
					onClick={() => setTheme(option.value)}
					className={cn(
						"p-1.5 transition-all",
						theme === option.value
							? "surface-control-pressed text-foreground"
							: "text-muted-foreground hover:text-foreground",
					)}
					title={option.label}
				>
					<option.icon className="h-3.5 w-3.5" />
				</button>
			))}
		</div>
	);
}

export function Layout() {
	const [activeSection, setActiveSection] = useState("foundations");

	return (
		<div className="flex h-screen w-screen overflow-hidden">
			<aside className="surface-panel flex w-56 shrink-0 flex-col border-r border-border">
				<div className="surface-panel-header px-4 py-3">
					<h1 className="font-display text-sm font-bold tracking-wide text-foreground">
						Engineering
					</h1>
					<span className="font-mono text-[0.625rem] text-muted-foreground">
						Design System
					</span>
				</div>
				<Navigation activeSection={activeSection} onSectionChange={setActiveSection} />
				<div className="mt-auto border-t border-border px-4 py-3">
					<div className="inline-flex">
						<ThemeToggle />
					</div>
				</div>
			</aside>
			<main className="flex-1 overflow-y-auto bg-background">
				<div className="mx-auto max-w-5xl p-8">
					<SectionContent section={activeSection} />
				</div>
			</main>
		</div>
	);
}

function SectionPlaceholder({ title }: { title: string }) {
	return (
		<div>
			<p className="mt-4 font-mono text-xs text-muted-foreground">
				{title} section content will be built in subsequent phases.
			</p>
		</div>
	);
}

function SectionContent({ section }: { section: string }) {
	const title = section.charAt(0).toUpperCase() + section.slice(1);

	return (
		<div>
			<h2 className="mb-4 font-display text-3xl font-bold tracking-wide text-foreground">
				{title}
			</h2>
			<div className="mb-12 h-px w-20 bg-primary/40" />
			{section === "foundations" ? (
				<Foundations />
			) : section === "components" ? (
				<Components />
			) : section === "workspace" ? (
				<Workspace />
			) : section === "processing" ? (
				<ProcessingSection />
			) : section === "modals" ? (
				<Modals />
			) : section === "theme" ? (
				<Theme />
			) : (
				<SectionPlaceholder title={title} />
			)}
		</div>
	);
}
