import { Menu, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "./ui/dropdown-menu";

export const Toolbar: React.FC = () => {
	const { theme, setTheme } = useTheme();

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
						<DropdownMenuItem disabled>Open</DropdownMenuItem>
						<DropdownMenuItem disabled>Save Session</DropdownMenuItem>
						<DropdownMenuItem disabled>Export</DropdownMenuItem>
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
}
