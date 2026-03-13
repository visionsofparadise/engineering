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
	const effectiveValue = initialValue ? initialValue : binaryPath ?? "";

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
				<div
					className="min-w-0 flex-1 truncate px-2.5 py-1 font-mono text-[0.625rem] tabular-nums"
					title={displayValue}
					style={{
						background: 'linear-gradient(170deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 25%, transparent 50%, transparent 75%, rgba(255,255,255,0.03) 100%) #000',
						boxShadow: [
							'inset 0 1px 0 rgba(255,255,255,0.18)',
							'inset 0 -1px 0 rgba(255,255,255,0.04)',
							'inset 1px 0 0 rgba(255,255,255,0.08)',
							'inset -1px 0 0 rgba(255,255,255,0.03)',
							'inset 0 2px 8px rgba(0,0,0,0.8)',
							'0 1px 0 rgba(255,255,255,0.06)',
						].join(', '),
						border: '1px solid rgba(255,255,255,0.1)',
						color: displayValue ? 'var(--primary)' : 'var(--muted-foreground)',
					}}
				>
					{filename}
				</div>
				<Button
					variant="secondary"
					size="icon"
					className="h-6 w-6 shrink-0"
					disabled={disabled}
					onClick={() => void handleBrowse()}
				>
					<Folder className="h-3 w-3" />
				</Button>
			</div>
		</div>
	);
};
