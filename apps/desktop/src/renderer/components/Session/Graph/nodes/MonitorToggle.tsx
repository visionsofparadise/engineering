import { Eye } from "lucide-react";
import { cn } from "../../../../utils/cn";

export function MonitorToggle({
	active,
	visible,
	onToggle,
}: {
	active: boolean;
	visible: boolean;
	onToggle?: () => void;
}) {
	if (!visible) return null;
	return (
		<button
			onClick={(ev) => {
				ev.stopPropagation();
				onToggle?.();
			}}
			onPointerDown={(ev) => ev.stopPropagation()}
			className={cn(
				"flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-all",
				active
					? "text-[var(--color-status-processing)]"
					: "text-muted-foreground/30 hover:text-muted-foreground/60",
			)}
		>
			<Eye className="h-3.5 w-3.5" />
		</button>
	);
}
