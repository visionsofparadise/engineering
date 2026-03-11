import { useState } from "react";
import type { AppContext } from "../../models/Context";
import type { ModulePackageState } from "../../models/State/App";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { addPackage } from "./utils/addPackage";
import { checkPackageUpdate } from "./utils/checkPackageUpdate";
import { removePackage } from "./utils/removePackage";

interface ModuleManagerProps {
	readonly context: AppContext;
	readonly open: boolean;
	readonly onOpenChange: (open: boolean) => void;
}

interface PackageUpdateState {
	readonly status: "idle" | "checking" | "available" | "up-to-date";
	readonly latestVersion?: string;
}

function formatModuleList(packageState: ModulePackageState): string {
	const names = packageState.modules.map((mod) => mod.moduleName);
	if (names.length <= 3) return names.join(", ");
	return `${names.slice(0, 3).join(", ")}, +${names.length - 3} more`;
}

export const ModuleManager: React.FC<ModuleManagerProps> = ({ context, open, onOpenChange }) => {
	const [url, setUrl] = useState("");
	const [installing, setInstalling] = useState(false);
	const [updateStates, setUpdateStates] = useState<Record<string, PackageUpdateState>>({});

	const packages = context.app.packages;

	const handleInstall = async () => {
		const trimmed = url.trim();
		if (!trimmed) return;
		setInstalling(true);
		try {
			await addPackage(trimmed, context);
			setUrl("");
		} finally {
			setInstalling(false);
		}
	};

	const handleRemove = async (directory: string) => {
		await removePackage(directory, context);
	};

	const handleCheckUpdate = async (packageState: ModulePackageState) => {
		setUpdateStates((prev) => ({ ...prev, [packageState.directory]: { status: "checking" } }));

		try {
			const result = await checkPackageUpdate(packageState, context);

			setUpdateStates((prev) => ({
				...prev,
				[packageState.directory]: result.updateAvailable ? { status: "available", latestVersion: result.latestVersion } : { status: "up-to-date" },
			}));
		} catch {
			setUpdateStates((prev) => ({ ...prev, [packageState.directory]: { status: "idle" } }));
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
		>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Module Packages</DialogTitle>
				</DialogHeader>

				<div className="flex gap-2">
					<Input
						placeholder="Package URL..."
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void handleInstall();
						}}
						className="h-8 text-xs"
					/>
					<Button
						variant="outline"
						size="sm"
						className="h-8 shrink-0 text-xs"
						disabled={!url.trim() || installing}
						onClick={() => void handleInstall()}
					>
						Install
					</Button>
				</div>

				<div className="flex flex-col gap-2">
					{packages.map((packageState) => {
						const updateState = updateStates[packageState.directory] ?? { status: "idle" };
						const isCore = context.app.packageUrls.find((config) => config.directory === packageState.directory)?.core;

						return (
							<div
								key={packageState.directory}
								className="flex flex-col gap-1 rounded-md border border-border p-3"
							>
								<div className="flex items-center justify-between">
									<span className="text-xs font-medium">{packageState.directory}</span>
									{packageState.version && <span className="text-[10px] text-muted-foreground">v{packageState.version}</span>}
								</div>
								{packageState.modules.length > 0 && <span className="text-[10px] text-muted-foreground">{formatModuleList(packageState)}</span>}
								<div className="flex justify-end gap-1 pt-1">
									<Button
										variant="ghost"
										size="sm"
										className="h-6 text-[10px]"
										disabled={updateState.status === "checking"}
										onClick={() => void handleCheckUpdate(packageState)}
									>
										{updateState.status === "checking"
											? "Checking..."
											: updateState.status === "available"
												? `Update to v${updateState.latestVersion}`
												: updateState.status === "up-to-date"
													? "Up to date"
													: "Check Update"}
									</Button>
									{!isCore && (
										<Button
											variant="ghost"
											size="sm"
											className="h-6 text-[10px] text-destructive"
											onClick={() => void handleRemove(packageState.directory)}
										>
											Remove
										</Button>
									)}
								</div>
							</div>
						);
					})}
				</div>

				<p className="text-[10px] text-muted-foreground">Packages run with full system access. Only add packages you trust.</p>
			</DialogContent>
		</Dialog>
	);
};
