import { useState } from "react";
import { Button } from "../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { FileInput } from "../components/ui/file-input";
import { Slider } from "../components/ui/slider";

function ExportModal() {
	const [format, setFormat] = useState("wav");

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">Export Dialog</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Export Audio</DialogTitle>
					<DialogDescription>
						Configure output format and quality settings.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-2">
					<div>
						<Label className="mb-2 block text-xs">Format</Label>
						<Select value={format} onValueChange={setFormat}>
							<SelectTrigger className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="wav">WAV</SelectItem>
								<SelectItem value="flac">FLAC</SelectItem>
								<SelectItem value="mp3">MP3</SelectItem>
								<SelectItem value="aac">AAC</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{(format === "wav" || format === "flac") && (
						<div>
							<Label className="mb-2 block text-xs">Bit Depth</Label>
							<Select defaultValue="24">
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="16">16-bit</SelectItem>
									<SelectItem value="24">24-bit</SelectItem>
									<SelectItem value="32">32-bit float</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}

					{(format === "mp3" || format === "aac") && (
						<div>
							<Label className="mb-2 block text-xs">Bitrate</Label>
							<Select defaultValue="320">
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="128">128 kbps</SelectItem>
									<SelectItem value="192">192 kbps</SelectItem>
									<SelectItem value="256">256 kbps</SelectItem>
									<SelectItem value="320">320 kbps</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}

					<div>
						<Label className="mb-2 block text-xs">Output Path</Label>
						<FileInput
							value="/audio/exports/processed_output"
							className="h-8"
						/>
					</div>

					<div className="bg-muted px-3 py-2">
						<div className="flex justify-between font-mono text-[0.625rem] text-muted-foreground">
							<span>Duration</span>
							<span>00:03:24.816</span>
						</div>
						<div className="flex justify-between font-mono text-[0.625rem] text-muted-foreground">
							<span>Sample Rate</span>
							<span>48000 Hz</span>
						</div>
						<div className="flex justify-between font-mono text-[0.625rem] text-muted-foreground">
							<span>Estimated Size</span>
							<span>{format === "wav" ? "29.4 MB" : format === "flac" ? "18.2 MB" : "7.8 MB"}</span>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" size="sm">Cancel</Button>
					<Button size="sm">Export</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function ConfirmationModal() {
	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="destructive" size="sm">Confirmation Dialog</Button>
			</DialogTrigger>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>Remove Processing Chain</DialogTitle>
					<DialogDescription>
						This will remove all modules from the processing chain. Processed audio will be discarded. This cannot be undone.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button variant="outline" size="sm">Cancel</Button>
					<Button variant="destructive" size="sm">Remove All</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function SettingsModal() {
	const [denoiseStrength, setDenoiseStrength] = useState([0.65]);
	const [sensitivity, setSensitivity] = useState([0.75]);

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button variant="secondary" size="sm">Settings Dialog</Button>
			</DialogTrigger>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>Transform Settings</DialogTitle>
					<DialogDescription>
						Configure parameters for the Voice Denoise module.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-5 py-2">
					<div>
						<div className="mb-2 flex items-baseline justify-between">
							<Label className="text-xs">Denoise Strength</Label>
							<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">
								{denoiseStrength[0]}
							</span>
						</div>
						<Slider value={denoiseStrength} onValueChange={setDenoiseStrength} min={0} max={1} step={0.01} />
					</div>
					<div>
						<div className="mb-2 flex items-baseline justify-between">
							<Label className="text-xs">Sensitivity</Label>
							<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">
								{sensitivity[0]}
							</span>
						</div>
						<Slider value={sensitivity} onValueChange={setSensitivity} min={0} max={1} step={0.01} />
					</div>
					<div>
						<Label className="mb-2 block text-xs">Model</Label>
						<Select defaultValue="large">
							<SelectTrigger className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="small">Small (fast)</SelectItem>
								<SelectItem value="medium">Medium (balanced)</SelectItem>
								<SelectItem value="large">Large (quality)</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" size="sm">Reset Defaults</Button>
					<Button size="sm">Apply</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function Modals() {
	return (
		<div className="space-y-8">
			<div>
				<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Modal Patterns
				</h4>
				<p className="mb-4 text-xs text-muted-foreground">
					Click each button to open the corresponding dialog pattern.
				</p>
				<div className="flex flex-wrap gap-3">
					<ExportModal />
					<ConfirmationModal />
					<SettingsModal />
				</div>
			</div>

			<div className="h-px bg-border" />

			<div>
				<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Dialog Guidelines
				</h4>
				<div className="space-y-2 text-xs text-muted-foreground">
					<div className="flex gap-3">
						<span className="w-20 shrink-0 font-mono text-[0.625rem] text-foreground">Export</span>
						<span>Format selection with conditional fields. Shows computed metadata (size, duration).</span>
					</div>
					<div className="flex gap-3">
						<span className="w-20 shrink-0 font-mono text-[0.625rem] text-foreground">Confirm</span>
						<span>Destructive action warning. Narrow width, clear consequence description, red action button.</span>
					</div>
					<div className="flex gap-3">
						<span className="w-20 shrink-0 font-mono text-[0.625rem] text-foreground">Settings</span>
						<span>Parameter editing form. Sliders with live values, reset to defaults option.</span>
					</div>
				</div>
			</div>
		</div>
	);
}
