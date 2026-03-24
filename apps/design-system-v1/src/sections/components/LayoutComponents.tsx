import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { ScrollArea } from "../../components/ui/scroll-area";
import { Separator } from "../../components/ui/separator";

function TabsShowcase() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Tabs
			</h4>
			<Tabs defaultValue="waveform" className="max-w-md">
				<TabsList>
					<TabsTrigger value="waveform">Waveform</TabsTrigger>
					<TabsTrigger value="spectrogram">Spectrogram</TabsTrigger>
					<TabsTrigger value="both">Both</TabsTrigger>
				</TabsList>
				<TabsContent value="waveform">
					<div className="border border-border bg-card p-4">
						<p className="text-sm text-muted-foreground">
							Waveform view shows the amplitude over time.
						</p>
					</div>
				</TabsContent>
				<TabsContent value="spectrogram">
					<div className="border border-border bg-card p-4">
						<p className="text-sm text-muted-foreground">
							Spectrogram view shows frequency content over time.
						</p>
					</div>
				</TabsContent>
				<TabsContent value="both">
					<div className="border border-border bg-card p-4">
						<p className="text-sm text-muted-foreground">
							Overlay mode combines waveform and spectrogram.
						</p>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}

function ScrollAreaShowcase() {
	const logEntries = [
		"[00:00.000] Session initialized",
		"[00:00.012] Loading audio file: voice_recording.wav",
		"[00:00.245] Audio loaded: 48000 Hz, 24-bit, 2 channels",
		"[00:00.248] Generating waveform data...",
		"[00:00.892] Waveform complete: 4096 points per channel",
		"[00:00.893] Generating spectrogram data...",
		"[00:02.341] Spectrogram complete: 2048 bins, 1024 frames",
		"[00:02.342] Rendering workspace view",
		"[00:02.356] Processing chain initialized (empty)",
		"[00:02.357] Session ready",
		"[00:05.120] Module added: Voice Denoise",
		"[00:05.121] Module added: Loudness",
		"[00:08.445] Processing started...",
		"[00:12.891] Voice Denoise complete (3.2x realtime)",
		"[00:15.234] Loudness complete (8.1x realtime)",
		"[00:15.235] Processing complete. Total: 6.9s",
	];

	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Scroll Area
			</h4>
			<ScrollArea className="h-48 max-w-md card-outline">
				<div className="p-3">
					{logEntries.map((entry, index) => (
						<div
							key={index}
							className="border-b border-border/30 py-1.5 font-mono text-[0.6875rem] text-muted-foreground last:border-0"
						>
							{entry}
						</div>
					))}
				</div>
			</ScrollArea>
		</div>
	);
}

function SeparatorShowcase() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Separator
			</h4>
			<div className="max-w-md space-y-4">
				<div>
					<span className="text-sm text-foreground">Horizontal</span>
					<Separator className="my-2" />
					<span className="text-sm text-muted-foreground">Content below the separator</span>
				</div>
				<div className="flex h-8 items-center gap-3">
					<span className="text-sm text-foreground">Item A</span>
					<Separator orientation="vertical" />
					<span className="text-sm text-foreground">Item B</span>
					<Separator orientation="vertical" />
					<span className="text-sm text-foreground">Item C</span>
				</div>
			</div>
		</div>
	);
}

export function LayoutComponents() {
	return (
		<div className="space-y-8">
			<TabsShowcase />
			<ScrollAreaShowcase />
			<SeparatorShowcase />
		</div>
	);
}
