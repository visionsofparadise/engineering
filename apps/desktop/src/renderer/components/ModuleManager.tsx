import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "@e9g/design-system";
import type { AppContext } from "../models/Context";
import { usePackageManager } from "../hooks/usePackageManager";

interface Props {
	readonly context: AppContext;
	readonly isOpen: boolean;
	readonly onClose: () => void;
}

export function ModuleManager({ context, isOpen, onClose }: Props) {
	const { app } = context;
	const { addPackage, removePackage, updatePackage } = usePackageManager(context);

	const [addUrl, setAddUrl] = useState("");
	const [expandedPackages, setExpandedPackages] = useState<Set<string>>(new Set());

	const handleEscape = useCallback(
		(event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		},
		[onClose],
	);

	useEffect(() => {
		if (!isOpen) return;

		document.addEventListener("keydown", handleEscape);

		return () => {
			document.removeEventListener("keydown", handleEscape);
		};
	}, [isOpen, handleEscape]);

	const handleOverlayClick = useCallback(
		(event: React.MouseEvent<HTMLDivElement>) => {
			if (event.target === event.currentTarget) {
				onClose();
			}
		},
		[onClose],
	);

	const handleAdd = useCallback(async () => {
		if (!addUrl.trim()) return;

		const url = addUrl.trim();

		setAddUrl("");
		await addPackage(url);
	}, [addUrl, addPackage]);

	const toggleExpanded = useCallback((name: string) => {
		setExpandedPackages((previous) => {
			const next = new Set(previous);

			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}

			return next;
		});
	}, []);

	if (!isOpen) return null;

	return (
		<div
			className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center"
			onClick={handleOverlayClick}
		>
			<div className="bg-chrome-base w-[640px] max-h-[80vh] flex flex-col overflow-hidden">
				{/* Header */}
				<div className="flex items-center justify-between px-4 py-3 border-b border-chrome-border">
					<h2 className="font-technical uppercase tracking-[0.06em] text-chrome-text text-md">
						Module Manager
					</h2>
					<Button variant="ghost" size="sm" onClick={onClose}>
						Close
					</Button>
				</div>

				<div className="flex-1 overflow-y-auto px-4 py-3">
					<ul className="flex flex-col gap-2">
						{app.packages.map((entry) => {
							const isExpanded = expandedPackages.has(entry.name);

							return (
								<li key={entry.url} className="bg-chrome-surface p-2">
									<div className="flex items-center gap-2">
										{/* Expand toggle */}
										{entry.modules.length > 0 && (
											<button
												type="button"
												className="text-chrome-text-secondary hover:text-chrome-text text-xs"
												onClick={() => toggleExpanded(entry.name)}
											>
												{isExpanded ? "\u25BC" : "\u25B6"}
											</button>
										)}

										{/* Package name */}
										<span className="font-body text-chrome-text flex-1">
											{entry.name}
										</span>

										{/* Version */}
										{entry.version && (
											<span className="font-technical tabular-nums text-chrome-text-secondary text-xs">
												{entry.version}
											</span>
										)}

										{/* Status badge */}
										{entry.status === "ready" && (
											<span className="font-technical uppercase tracking-[0.06em] text-primary text-xs">
												Ready
											</span>
										)}
										{entry.status === "error" && (
											<span className="font-technical uppercase tracking-[0.06em] text-red-400 text-xs">
												Error
											</span>
										)}
										{entry.status !== "ready" && entry.status !== "error" && (
											<span className="font-technical uppercase tracking-[0.06em] text-chrome-text-secondary text-xs">
												{entry.status}
											</span>
										)}

										{/* Module count */}
										<span className="font-technical tabular-nums text-chrome-text-dim text-xs">
											{entry.modules.length} modules
										</span>

										{/* Actions */}
										<div className="flex items-center gap-1">
											<Button
												variant="secondary"
												size="sm"
												onClick={() => void updatePackage(entry.name)}
											>
												Update
											</Button>
											{!entry.isBuiltIn && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => void removePackage(entry.name)}
												>
													Remove
												</Button>
											)}
										</div>
									</div>

									{/* Error message */}
									{entry.status === "error" && entry.error && (
										<div className="text-xs text-red-400 mt-1">{entry.error}</div>
									)}

									{/* Expanded module list */}
									{isExpanded && entry.modules.length > 0 && (
										<ul className="mt-2 ml-4 flex flex-col gap-1">
											{entry.modules.map((mod) => (
												<li key={mod.moduleName} className="flex flex-col">
													<span className="font-technical text-chrome-text text-xs">
														{mod.moduleName}
													</span>
													{mod.moduleDescription && (
														<span className="font-body text-chrome-text-secondary text-xs">
															{mod.moduleDescription}
														</span>
													)}
												</li>
											))}
										</ul>
									)}
								</li>
							);
						})}
					</ul>

					{/* Add package */}
					<div className="flex items-end gap-2 mt-3">
						<Input
							label="Git URL"
							value={addUrl}
							placeholder="https://github.com/..."
							onChange={setAddUrl}
							className="flex-1"
						/>
						<Button variant="primary" onClick={() => void handleAdd()}>
							Add
						</Button>
					</div>

					<p className="text-chrome-text-dim text-xs mt-2">
						Packages run with full system access.
					</p>
				</div>
			</div>
		</div>
	);
}
