import { Folder } from "lucide-react";
import { useState } from "react";
import type { AppContext } from "../../../../models/Context";
import { Button } from "../../../ui/button";
import { Label } from "../../../ui/label";
import type { JsonSchemaProperty } from "./utils/schema";

interface FileParameterProps {
	readonly label: string;
	readonly initialValue: string;
	readonly property: JsonSchemaProperty;
	readonly onCommit: (value: unknown) => void;
	readonly context: AppContext;
	readonly disabled?: boolean;
}

export const FileParameter: React.FC<FileParameterProps> = ({ label, initialValue, property, onCommit, context, disabled }) => {
	const binaryKey = property.binary;
	const binaryPath = binaryKey ? context.app.binaries[binaryKey] : undefined;
	const effectiveValue = initialValue || binaryPath || "";

	const [displayValue, setDisplayValue] = useState(effectiveValue);

	const handleBrowse = async (): Promise<void> => {
		const accept = property.accept;
		const filters = accept
			? [{ name: label, extensions: accept.split(",").map((ext) => ext.replace(".", "").trim()) }]
			: undefined;

		if (property.mode === "save") {
			const path = await context.main.showSaveDialog({
				title: label,
				filters,
			});
			if (path) {
				setDisplayValue(path);
				onCommit(path);
			}
		} else {
			const dialogProps = property.input === "folder" ? ["openDirectory" as const] : ["openFile" as const];
			const paths = await context.main.showOpenDialog({
				title: label,
				filters,
				properties: dialogProps,
			});
			const selected = paths?.[0];
			if (selected) {
				setDisplayValue(selected);
				onCommit(selected);

				if (binaryKey && !context.app.binaries[binaryKey]) {
					context.appStore.mutate(context.app, (proxy) => {
						proxy.binaries[binaryKey] = selected;
					});
				}
			}
		}
	};

	const filename = displayValue ? displayValue.replace(/^.*[\\/]/, "") : "Not set";

	return (
		<div className="grid gap-1">
			<Label className="text-xs">{label}</Label>
			<div className="flex items-center gap-1">
				<div className="min-w-0 flex-1 truncate rounded border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground" title={displayValue}>
					{filename}
				</div>
				<Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" disabled={disabled} onClick={() => void handleBrowse()}>
					<Folder className="h-3 w-3" />
				</Button>
			</div>
		</div>
	);
};
