import {
	Play,
	Pause,
	Square,
	SkipBack,
	SkipForward,
	Volume2,
	VolumeX,
	FolderOpen,
	FileAudio,
	Download,
	Upload,
	Save,
	X,
	Plus,
	Minus,
	Settings,
	ChevronDown,
	ChevronRight,
	Check,
	AlertCircle,
	Info,
	TriangleAlert,
	CircleCheck,
	OctagonX,
	LoaderCircle,
	Sun,
	Moon,
	Monitor,
	Trash2,
	Copy,
	Scissors,
	Undo,
	Redo,
	ZoomIn,
	ZoomOut,
	Maximize2,
	GripVertical,
	type LucideIcon,
} from "lucide-react";

interface IconEntry {
	name: string;
	icon: LucideIcon;
}

interface IconGroup {
	title: string;
	icons: Array<IconEntry>;
}

const ICON_GROUPS: Array<IconGroup> = [
	{
		title: "Transport",
		icons: [
			{ name: "Play", icon: Play },
			{ name: "Pause", icon: Pause },
			{ name: "Stop", icon: Square },
			{ name: "Skip Back", icon: SkipBack },
			{ name: "Skip Forward", icon: SkipForward },
			{ name: "Volume", icon: Volume2 },
			{ name: "Mute", icon: VolumeX },
		],
	},
	{
		title: "File Operations",
		icons: [
			{ name: "Open Folder", icon: FolderOpen },
			{ name: "Audio File", icon: FileAudio },
			{ name: "Download", icon: Download },
			{ name: "Upload", icon: Upload },
			{ name: "Save", icon: Save },
		],
	},
	{
		title: "UI Chrome",
		icons: [
			{ name: "Close", icon: X },
			{ name: "Add", icon: Plus },
			{ name: "Remove", icon: Minus },
			{ name: "Settings", icon: Settings },
			{ name: "Chevron Down", icon: ChevronDown },
			{ name: "Chevron Right", icon: ChevronRight },
			{ name: "Check", icon: Check },
			{ name: "Grip", icon: GripVertical },
			{ name: "Maximize", icon: Maximize2 },
		],
	},
	{
		title: "Status",
		icons: [
			{ name: "Info", icon: Info },
			{ name: "Warning", icon: TriangleAlert },
			{ name: "Error", icon: AlertCircle },
			{ name: "Success", icon: CircleCheck },
			{ name: "Fatal", icon: OctagonX },
			{ name: "Loading", icon: LoaderCircle },
		],
	},
	{
		title: "Edit",
		icons: [
			{ name: "Delete", icon: Trash2 },
			{ name: "Copy", icon: Copy },
			{ name: "Cut", icon: Scissors },
			{ name: "Undo", icon: Undo },
			{ name: "Redo", icon: Redo },
			{ name: "Zoom In", icon: ZoomIn },
			{ name: "Zoom Out", icon: ZoomOut },
		],
	},
	{
		title: "Theme",
		icons: [
			{ name: "Light", icon: Sun },
			{ name: "Dark", icon: Moon },
			{ name: "System", icon: Monitor },
		],
	},
];

const ICON_SIZES = [16, 20, 24] as const;

function IconCell({ entry }: { entry: IconEntry }) {
	const Icon = entry.icon;
	return (
		<div className="flex flex-col items-center gap-2 border border-border/50 bg-card p-3">
			<Icon className="h-5 w-5 text-foreground" />
			<span className="font-mono text-[0.625rem] text-muted-foreground">{entry.name}</span>
		</div>
	);
}

function SizeDemo() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Recommended Sizes
			</h4>
			<div className="flex items-end gap-6">
				{ICON_SIZES.map((size) => (
					<div key={size} className="flex flex-col items-center gap-2">
						<Settings style={{ width: size, height: size }} className="text-foreground" />
						<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">{size}px</span>
					</div>
				))}
			</div>
		</div>
	);
}

export function Icons() {
	return (
		<div className="space-y-8">
			<SizeDemo />
			<div className="h-px bg-border" />
			{ICON_GROUPS.map((group) => (
				<div key={group.title}>
					<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
						{group.title}
					</h4>
					<div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
						{group.icons.map((entry) => (
							<IconCell key={entry.name} entry={entry} />
						))}
					</div>
				</div>
			))}
		</div>
	);
}
