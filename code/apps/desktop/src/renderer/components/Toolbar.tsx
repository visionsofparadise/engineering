import { Menu, Monitor, Moon, Sun } from "lucide-react";
import { useImportFile } from "../hooks/useImportFile";
import type { AppContext } from "../models/Context";
import { addTab } from "../utils/tabs";
import { useTheme } from "./ThemeProvider";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./ui/dropdown-menu";

const AUDIO_FILTERS = [{ name: "Audio Files", extensions: ["wav", "mp3", "flac", "aac", "m4a", "ogg"] }];

interface ToolbarProps {
	context: AppContext;
	onManagePackages: () => void;
	onManageBinaries: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ context, onManagePackages, onManageBinaries }) => {
	const { theme, setTheme } = useTheme();
	const importFile = useImportFile(context);

	const activeTab = context.app.tabs.find((tab) => tab.id === context.app.activeTabId);

	const handleSaveSession = async (): Promise<void> => {
		if (!activeTab) return;

		const defaultName = activeTab.label.replace(/\.[^.]+$/, "");

		const targetPath = await context.main.showSaveDialog({
			title: "Save Session",
			defaultPath: `${defaultName}.eng`,
			filters: [{ name: "Engineering Session", extensions: ["eng"] }],
		});

		if (!targetPath) return;

		await context.main.sessionSave({ sessionPath: activeTab.workingDir, targetPath });
	};

	const handleOpenSession = async (): Promise<void> => {
		const paths = await context.main.showOpenDialog({
			title: "Open Session",
			filters: [{ name: "Engineering Session", extensions: ["eng"] }],
			properties: ["openFile"],
		});

		const filePath = paths?.[0];

		if (!filePath) return;

		const result = await context.main.sessionOpen({ filePath });

		addTab(
			{
				id: result.sessionId,
				label: result.label,
				filePath,
				workingDir: result.sessionPath,
				activeSnapshotFolder: undefined,
			},
			{ app: context.app, appStore: context.appStore },
		);
	};

	const handleOpen = async (): Promise<void> => {
		const paths = await context.main.showOpenDialog({
			title: "Open Audio File",
			filters: AUDIO_FILTERS,
			properties: ["openFile"],
		});

		const filePath = paths?.[0];
		if (filePath) {
			importFile.mutate(filePath);
		}
	};

	return (
		<div
			className="relative flex h-10 items-center border-b border-border px-2"
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			<div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7"
						>
							<Menu className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						<DropdownMenuItem
							disabled={importFile.isPending}
							onClick={() => void handleOpen()}
						>
							Open
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => void handleOpenSession()}>Open Session</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!activeTab}
							onClick={() => void handleSaveSession()}
						>
							Save Session
						</DropdownMenuItem>
						<DropdownMenuItem
							disabled={!context.app.activeTabId}
							onClick={() => window.dispatchEvent(new Event("open-export-modal"))}
						>
							Export
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={onManagePackages}>
							Manage Packages...
						</DropdownMenuItem>
						<DropdownMenuItem onClick={onManageBinaries}>
							Binary Manager...
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuSub>
							<DropdownMenuSubTrigger>
								{theme === "dark" ? <Moon className="h-4 w-4" /> : theme === "light" ? <Sun className="h-4 w-4" /> : <Monitor className="h-4 w-4" />}
								Theme
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent>
								<DropdownMenuItem onClick={() => setTheme("light")}>
									<Sun className="h-4 w-4" />
									Light
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => setTheme("dark")}>
									<Moon className="h-4 w-4" />
									Dark
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => setTheme("system")}>
									<Monitor className="h-4 w-4" />
									System
								</DropdownMenuItem>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
						<DropdownMenuSeparator />
						<DropdownMenuItem onClick={() => window.close()}>Close App</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
				<span className="text-sm font-medium">Engineering</span>
			</div>

			<div className="flex-1" />

			<div className="w-[138px]" />
		</div>
	);
};
