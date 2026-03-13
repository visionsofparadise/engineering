import { useState } from "react";
import { Input } from "../../components/ui/input";
import { FileInput } from "../../components/ui/file-input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { Slider } from "../../components/ui/slider";
import { Switch } from "../../components/ui/switch";

function InputShowcase() {
	const [filePath, setFilePath] = useState("/audio/session/master.wav");

	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Input
			</h4>
			<div className="grid max-w-sm gap-4">
				<div>
					<Label htmlFor="default-input" className="mb-2 block">Default</Label>
					<Input id="default-input" placeholder="Enter value..." />
				</div>
				<div>
					<Label htmlFor="disabled-input" className="mb-2 block">Disabled</Label>
					<Input id="disabled-input" disabled value="Cannot edit" />
				</div>
				<div>
					<Label className="mb-2 block">File Path</Label>
					<FileInput
						value={filePath}
						onValueChange={setFilePath}
						accept="audio/*"
					/>
				</div>
			</div>
		</div>
	);
}

function SelectShowcase() {
	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Select
			</h4>
			<div className="grid max-w-sm gap-4">
				<div>
					<Label className="mb-2 block">Format</Label>
					<Select defaultValue="wav">
						<SelectTrigger>
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
				<div>
					<Label className="mb-2 block">Bit Depth</Label>
					<Select disabled>
						<SelectTrigger>
							<SelectValue placeholder="Disabled" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="16">16-bit</SelectItem>
							<SelectItem value="24">24-bit</SelectItem>
							<SelectItem value="32">32-bit float</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
		</div>
	);
}

function SliderShowcase() {
	const [loudnessTarget, setLoudnessTarget] = useState([-14]);
	const [truePeak, setTruePeak] = useState([-1]);

	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Slider
			</h4>
			<div className="grid max-w-sm gap-6">
				<div className="space-y-3">
					<div className="flex items-baseline justify-between">
						<Label>Target Loudness</Label>
						<span className="font-mono text-xs tabular-nums text-muted-foreground">
							{loudnessTarget[0]} LUFS
						</span>
					</div>
					<Slider
						value={loudnessTarget}
						onValueChange={setLoudnessTarget}
						min={-50}
						max={0}
						step={0.1}
					/>
				</div>
				<div className="space-y-3">
					<div className="flex items-baseline justify-between">
						<Label>True Peak</Label>
						<span className="font-mono text-xs tabular-nums text-muted-foreground">
							{truePeak[0]} dBTP
						</span>
					</div>
					<Slider
						value={truePeak}
						onValueChange={setTruePeak}
						min={-10}
						max={0}
						step={0.1}
					/>
				</div>
			</div>
		</div>
	);
}

function SwitchShowcase() {
	const [enabled, setEnabled] = useState(true);

	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Switch
			</h4>
			<div className="grid max-w-sm gap-4">
				<div className="flex items-center justify-between">
					<Label htmlFor="bypass-switch">Bypass Module</Label>
					<Switch id="bypass-switch" checked={enabled} onCheckedChange={setEnabled} />
				</div>
				<div className="flex items-center justify-between">
					<Label htmlFor="disabled-switch" className="opacity-50">Disabled</Label>
					<Switch id="disabled-switch" disabled />
				</div>
			</div>
		</div>
	);
}

function RealisticForm() {
	const [target, setTarget] = useState([-14]);
	const [peak, setPeak] = useState([-1]);
	const [bypass, setBypass] = useState(false);

	return (
		<div>
			<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
				Realistic Form — Loudness Module
			</h4>
			<div className="max-w-sm border border-border bg-card p-5">
				<div className="mb-4 flex items-center justify-between">
					<span className="text-sm font-medium text-card-foreground">Loudness</span>
					<Switch checked={!bypass} onCheckedChange={(checked) => setBypass(!checked)} />
				</div>
				<div className="space-y-5">
					<div>
						<div className="mb-2 flex items-baseline justify-between">
							<Label className="text-xs">Target</Label>
							<span className="font-mono text-xs tabular-nums text-muted-foreground">
								{target[0]} LUFS
							</span>
						</div>
						<Slider value={target} onValueChange={setTarget} min={-50} max={0} step={0.1} />
					</div>
					<div>
						<div className="mb-2 flex items-baseline justify-between">
							<Label className="text-xs">True Peak</Label>
							<span className="font-mono text-xs tabular-nums text-muted-foreground">
								{peak[0]} dBTP
							</span>
						</div>
						<Slider value={peak} onValueChange={setPeak} min={-10} max={0} step={0.1} />
					</div>
					<div>
						<Label className="mb-2 block text-xs">Standard</Label>
						<Select defaultValue="ebu-r128">
							<SelectTrigger className="h-8 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="ebu-r128">EBU R128</SelectItem>
								<SelectItem value="atsc-a85">ATSC A/85</SelectItem>
								<SelectItem value="custom">Custom</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
			</div>
		</div>
	);
}

export function FormControls() {
	return (
		<div className="space-y-8">
			<InputShowcase />
			<SelectShowcase />
			<SliderShowcase />
			<SwitchShowcase />
			<div className="h-px bg-border" />
			<RealisticForm />
		</div>
	);
}
