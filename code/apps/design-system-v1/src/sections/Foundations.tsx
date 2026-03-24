import { useState } from "react";
import { cn } from "../utils/cn";
import { Colors } from "./foundations/Colors";
import { Typography } from "./foundations/Typography";
import { Spacing } from "./foundations/Spacing";
import { Icons } from "./foundations/Icons";
import { Materials } from "./foundations/Materials";

const SUBSECTIONS = [
	{ id: "colors", label: "Colors", component: Colors },
	{ id: "materials", label: "Materials", component: Materials },
	{ id: "typography", label: "Typography", component: Typography },
	{ id: "spacing", label: "Spacing", component: Spacing },
	{ id: "icons", label: "Icons", component: Icons },
] as const;

export function Foundations() {
	const [activeSubsection, setActiveSubsection] = useState("colors");
	const ActiveComponent = SUBSECTIONS.find((sub) => sub.id === activeSubsection)?.component ?? Colors;

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
