import { Button } from "../../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../../components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../components/ui/tooltip";
import { Slider } from "../../components/ui/slider";
import { Label } from "../../components/ui/label";

function DialogShowcase() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Dialog
			</h4>
			<div className="flex gap-3">
				<Dialog>
					<DialogTrigger asChild>
						<Button variant="outline" size="sm">Open Dialog</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Export Audio</DialogTitle>
							<DialogDescription>
								Configure export settings for the processed audio file.
							</DialogDescription>
						</DialogHeader>
						<div className="space-y-3 py-2">
							<div className="flex items-baseline justify-between">
								<span className="text-sm text-foreground">Format</span>
								<span className="font-mono text-xs text-muted-foreground">WAV 24-bit</span>
							</div>
							<div className="flex items-baseline justify-between">
								<span className="text-sm text-foreground">Sample Rate</span>
								<span className="font-mono text-xs text-muted-foreground">48000 Hz</span>
							</div>
							<div className="flex items-baseline justify-between">
								<span className="text-sm text-foreground">Duration</span>
								<span className="font-mono text-xs text-muted-foreground">00:03:24.816</span>
							</div>
						</div>
						<DialogFooter>
							<Button variant="outline" size="sm">Cancel</Button>
							<Button size="sm">Export</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>

				<Dialog>
					<DialogTrigger asChild>
						<Button variant="destructive" size="sm">Destructive Dialog</Button>
					</DialogTrigger>
					<DialogContent>
						<DialogHeader>
							<DialogTitle>Remove Module</DialogTitle>
							<DialogDescription>
								This will remove the Loudness module from the processing chain. This action cannot be undone.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button variant="outline" size="sm">Cancel</Button>
							<Button variant="destructive" size="sm">Remove</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	);
}

function DropdownShowcase() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Dropdown Menu
			</h4>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="outline" size="sm">Open Menu</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuLabel>Transform</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<DropdownMenuItem>Add Module</DropdownMenuItem>
					<DropdownMenuItem>Duplicate</DropdownMenuItem>
					<DropdownMenuItem>Move Up</DropdownMenuItem>
					<DropdownMenuItem>Move Down</DropdownMenuItem>
					<DropdownMenuSeparator />
					<DropdownMenuItem className="text-destructive">Remove</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function PopoverShowcase() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Popover
			</h4>
			<Popover>
				<PopoverTrigger asChild>
					<Button variant="outline" size="sm">Edit Parameters</Button>
				</PopoverTrigger>
				<PopoverContent className="w-72">
					<div className="space-y-4">
						<div className="space-y-1">
							<h4 className="text-sm font-medium text-popover-foreground">De-Click</h4>
							<p className="text-xs text-muted-foreground">Remove clicks and pops from audio</p>
						</div>
						<div className="space-y-2">
							<div className="flex items-baseline justify-between">
								<Label className="text-xs">Sensitivity</Label>
								<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">0.75</span>
							</div>
							<Slider defaultValue={[75]} max={100} step={1} />
						</div>
						<div className="space-y-2">
							<div className="flex items-baseline justify-between">
								<Label className="text-xs">Max Duration</Label>
								<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">150 ms</span>
							</div>
							<Slider defaultValue={[150]} max={1000} step={1} />
						</div>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function TooltipShowcase() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Tooltip
			</h4>
			<TooltipProvider>
				<div className="flex gap-3">
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="outline" size="sm">Hover me</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p className="text-xs">Process the selected audio region</p>
						</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button variant="ghost" size="sm" className="font-mono text-xs">
								-14.2 LUFS
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p className="text-xs">Integrated loudness (EBU R128)</p>
						</TooltipContent>
					</Tooltip>
				</div>
			</TooltipProvider>
		</div>
	);
}

export function Overlays() {
	return (
		<div className="space-y-8">
			<DialogShowcase />
			<DropdownShowcase />
			<PopoverShowcase />
			<TooltipShowcase />
		</div>
	);
}
