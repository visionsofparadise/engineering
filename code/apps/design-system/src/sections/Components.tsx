import { useState } from "react";
import { cn } from "../utils/cn";
import { Buttons } from "./components/Buttons";
import { FormControls } from "./components/FormControls";
import { Overlays } from "./components/Overlays";
import { LayoutComponents } from "./components/LayoutComponents";

const SUBSECTIONS = [
	{ id: "buttons", label: "Buttons", component: Buttons },
	{ id: "forms", label: "Form Controls", component: FormControls },
	{ id: "overlays", label: "Overlays", component: Overlays },
	{ id: "layout", label: "Layout", component: LayoutComponents },
] as const;

export function Components() {
	const [activeSubsection, setActiveSubsection] = useState("buttons");
	const ActiveComponent = SUBSECTIONS.find((sub) => sub.id === activeSubsection)?.component ?? Buttons;

	return (
		<div>
			<div className="mb-6 flex gap-1">
				{SUBSECTIONS.map((sub) => (
					<button
						key={sub.id}
						onClick={() => setActiveSubsection(sub.id)}
						className={cn(
							" px-3 py-1.5 font-mono text-xs transition-colors",
							activeSubsection === sub.id
								? "bg-accent text-accent-foreground"
								: "text-muted-foreground hover:text-foreground",
						)}
					>
						{sub.label}
					</button>
				))}
			</div>
			<ActiveComponent />
		</div>
	);
}
