import { resnapshot } from "../../models/ProxyStore/resnapshot";
import { AlertTriangle, Package, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AppContext } from "../../models/Context";
import type { ModulePackageState } from "../../models/State/App";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { ScrollArea } from "../ui/scroll-area";
import { addPackage } from "./utils/addPackage";
import { applyPackageUpdate, checkPackageUpdate } from "./utils/checkPackageUpdate";
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

function formatModuleCount(packageState: ModulePackageState): string {
	const count = packageState.modules.length;
	if (count === 0) return "No modules";
	return `${count} module${count === 1 ? "" : "s"}`;
}

export const ModuleManager: React.FC<ModuleManagerProps> = resnapshot(({ context, open, onOpenChange }) => {
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

			if (result.updateAvailable) {
				setUpdateStates((prev) => ({
					...prev,
					[packageState.directory]: { status: "available", latestVersion: result.latestVersion },
				}));
			} else {
				setUpdateStates((prev) => ({ ...prev, [packageState.directory]: { status: "up-to-date" } }));
			}
		} catch {
			setUpdateStates((prev) => ({ ...prev, [packageState.directory]: { status: "idle" } }));
		}
	};

	const handleApplyUpdate = async (packageState: ModulePackageState) => {
		setUpdateStates((prev) => ({ ...prev, [packageState.directory]: { status: "idle" } }));
		await applyPackageUpdate(packageState.directory, context);
	};

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>Packages</DialogTitle>
					<DialogDescription className="text-xs">
						Extend your module library by installing community packages. Each package can provide one or more audio processing modules.
					</DialogDescription>
				</DialogHeader>

				<div className="flex items-start gap-2 rounded border border-yellow-500/30 bg-yellow-500/5 px-3 py-2 text-xs text-yellow-200/80">
					<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-yellow-500" />
					<span>Packages have full system access — only install packages from sources you trust.</span>
				</div>

				<div className="grid gap-2">
					<Label>Add package</Label>
					<div className="flex gap-2">
						<Input
							placeholder="https://github.com/user/repo.git"
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
							{installing ? "Installing..." : "Install"}
						</Button>
					</div>
					<p className="text-[0.6875rem] text-muted-foreground">
						Paste a Git repository URL to clone, build, and load the package.
					</p>
				</div>

				<ScrollArea className="max-h-[50vh]" alwaysShowScrollbar>
					<div className="space-y-3">
						{packages.length === 0 ? (
							<p className="py-6 text-center text-sm text-muted-foreground">
								No packages installed yet.
							</p>
						) : (
							packages.map((packageState) => {
								const updateState = updateStates[packageState.directory] ?? { status: "idle" };
								const displayName = packageState.name ?? packageState.directory;

								return (
									<div key={packageState.directory} className="card-outline flex flex-col gap-2">
										<div className="flex items-start justify-between gap-2">
											<div className="flex items-center gap-2 min-w-0">
												<Package className="h-4 w-4 shrink-0 text-muted-foreground" />
												<span className="truncate text-sm font-medium">{displayName}</span>
												{packageState.version && (
													<span className="shrink-0 text-[0.6875rem] text-muted-foreground">v{packageState.version}</span>
												)}
											</div>
											<span className="shrink-0 text-[0.6875rem] text-muted-foreground">
												{formatModuleCount(packageState)}
											</span>
										</div>

										{packageState.description && (
											<p className="text-[0.6875rem] leading-relaxed text-muted-foreground">{packageState.description}</p>
										)}

										{packageState.modules.length > 0 && (
											<div className="flex flex-wrap gap-1.5">
												{packageState.modules.map((mod) => (
													<span key={mod.moduleName} className="rounded bg-muted px-1.5 py-0.5 text-[0.625rem] text-muted-foreground">
														{mod.moduleName}
													</span>
												))}
											</div>
										)}

										<div className="flex items-center justify-end gap-1 border-t border-border pt-2">
											{updateState.status === "available" ? (
												<Button
													variant="outline"
													size="sm"
													className="h-6 gap-1 text-[0.625rem]"
													onClick={() => void handleApplyUpdate(packageState)}
												>
													<RefreshCw className="h-3 w-3" />
													Update to v{updateState.latestVersion}
												</Button>
											) : (
												<Button
													variant="ghost"
													size="sm"
													className="h-6 gap-1 text-[0.625rem]"
													disabled={updateState.status === "checking"}
													onClick={() => void handleCheckUpdate(packageState)}
												>
													<RefreshCw className={`h-3 w-3 ${updateState.status === "checking" ? "animate-spin" : ""}`} />
													{updateState.status === "checking"
														? "Checking..."
														: updateState.status === "up-to-date"
															? "Up to date"
															: "Check for updates"}
												</Button>
											)}
											<Button
												variant="ghost"
												size="sm"
												className="h-6 gap-1 text-[0.625rem] text-destructive hover:text-destructive"
												onClick={() => void handleRemove(packageState.directory)}
											>
												<Trash2 className="h-3 w-3" />
												Remove
											</Button>
										</div>
									</div>
								);
							})
						)}
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
});
