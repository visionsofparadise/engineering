import { IconButton, DropdownButton } from "@e9g/design-system";
import type { MenuItem } from "@e9g/design-system";

export function NodeMenu({ isSource, isProcessing, isPending, isBypassed, isInspected, isRendered, onRender, onAbort, onView }: {
	readonly isSource: boolean;
	readonly isProcessing: boolean;
	readonly isPending: boolean;
	readonly isBypassed: boolean;
	readonly isInspected: boolean;
	readonly isRendered: boolean;
	readonly onRender?: () => void;
	readonly onAbort?: () => void;
	readonly onView?: () => void;
}) {
	let renderLabel = "Render";
	let renderColor = "text-chrome-text";

	if (isProcessing) { renderLabel = "Abort"; renderColor = "text-state-error"; }
	else if (isPending) { renderLabel = "Pending"; renderColor = "text-chrome-text-dim"; }

	const items: Array<MenuItem> = [];

	items.push({
		kind: "action",
		label: "View",
		icon: "lucide:eye",
		disabled: !isRendered,
		onClick: onView,
	});

	if (isSource) {
		items.push({
			kind: "action",
			label: "Inspect",
			icon: "lucide:eye",
			color: isInspected ? "text-primary" : undefined,
		});
	}

	if (!isSource) {
		items.push({
			kind: "action",
			label: renderLabel,
			icon: isProcessing ? "lucide:square" : "lucide:play",
			color: renderColor,
			onClick: isProcessing ? onAbort : onRender,
		});
	}

	items.push({
		kind: "action",
		label: isBypassed ? "Enable" : "Bypass",
		icon: "lucide:power",
		color: isBypassed ? "text-secondary" : undefined,
	});

	items.push({ kind: "separator" });

	items.push({
		kind: "action",
		label: "Delete",
		icon: "lucide:trash-2",
		color: "text-state-error",
	});

	return (
		<DropdownButton
			trigger={<IconButton icon="lucide:ellipsis-vertical" label="Node menu" dim />}
			items={items}
			align="right"
		/>
	);
}
