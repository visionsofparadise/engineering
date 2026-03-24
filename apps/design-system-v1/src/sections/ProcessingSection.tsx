import { useState } from "react";
import { cn } from "../utils/cn";
import { Processing } from "./Processing";
import { GraphEditor } from "./GraphEditor";
import { Progress } from "./Progress";

const SUBSECTIONS = [
	{ id: "chain", label: "Chain", component: Processing },
	{ id: "graph", label: "Graph", component: GraphEditor },
	{ id: "progress", label: "Progress", component: Progress },
] as const;

export function ProcessingSection() {
	const [activeSubsection, setActiveSubsection] = useState("chain");
	const ActiveComponent = SUBSECTIONS.find((sub) => sub.id === activeSubsection)?.component ?? Processing;

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
