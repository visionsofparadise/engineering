import { useState } from "react";
import { Settings, FileAudio, Download, AlertTriangle } from "lucide-react";
import { cn } from "../utils/cn";
import { Slider } from "../components/ui/slider";
import { Switch } from "../components/ui/switch";
import { Label } from "../components/ui/label";
import { Input } from "../components/ui/input";
import { FileInput } from "../components/ui/file-input";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";

interface ModuleDefinition {
	name: string;
	description: string;
	state: "active" | "bypassed" | "incomplete";
	parameters: Array<ParameterDefinition>;
}

type ParameterDefinition =
	| { type: "slider"; name: string; min: number; max: number; step: number; defaultValue: number; unit: string }
	| { type: "select"; name: string; options: Array<string>; defaultValue: string }
	| { type: "toggle"; name: string; defaultValue: boolean }
	| { type: "number"; name: string; min: number; max: number; defaultValue: number; unit: string }
	| { type: "file"; name: string; accept?: string; defaultValue?: string };

const DEMO_CHAIN: Array<ModuleDefinition> = [
	{
		name: "Voice Denoise",
		state: "active",
		description: "Remove background noise from voice recordings",
		parameters: [
			{ type: "slider", name: "Strength", min: 0, max: 1, step: 0.01, defaultValue: 0.65, unit: "" },
			{ type: "toggle", name: "Preserve Reverb", defaultValue: true },
		],
	},
	{
		name: "De-Click",
		state: "bypassed",
		description: "Remove clicks and pops",
		parameters: [
			{ type: "slider", name: "Sensitivity", min: 0, max: 1, step: 0.01, defaultValue: 0.75, unit: "" },
			{ type: "number", name: "Max Duration", min: 1, max: 1000, defaultValue: 150, unit: "ms" },
		],
	},
	{
		name: "Loudness",
		state: "active",
		description: "Normalize integrated loudness to target",
		parameters: [
			{ type: "slider", name: "Target", min: -50, max: 0, step: 0.1, defaultValue: -14, unit: "LUFS" },
			{ type: "slider", name: "True Peak", min: -10, max: 0, step: 0.1, defaultValue: -1, unit: "dBTP" },
			{ type: "select", name: "Standard", options: ["EBU R128", "ATSC A/85", "Custom"], defaultValue: "EBU R128" },
		],
	},
	{
		name: "EQ Match",
		state: "incomplete",
		description: "Match spectral profile to reference",
		parameters: [
			{ type: "file", name: "Reference", accept: "audio/*" },
			{ type: "slider", name: "Strength", min: 0, max: 1, step: 0.01, defaultValue: 0.80, unit: "" },
			{ type: "slider", name: "Smoothing", min: 1, max: 100, step: 1, defaultValue: 24, unit: "bands" },
		],
	},
];

function ParameterControl({ parameter }: { parameter: ParameterDefinition }) {
	const [sliderValue, setSliderValue] = useState([parameter.type === "slider" ? parameter.defaultValue : 0]);
	const [toggleValue, setToggleValue] = useState(parameter.type === "toggle" ? parameter.defaultValue : false);
	const [fileValue, setFileValue] = useState(parameter.type === "file" ? parameter.defaultValue ?? "" : "");

	if (parameter.type === "file") {
		return (
			<div>
				<Label className="mb-2 block text-[0.6875rem]">{parameter.name}</Label>
				<FileInput value={fileValue} onValueChange={setFileValue} accept={parameter.accept} />
			</div>
		);
	}

	if (parameter.type === "slider") {
		return (
			<div>
				<div className="mb-2 flex items-baseline justify-between">
					<Label className="text-[0.6875rem]">{parameter.name}</Label>
					<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">
						{sliderValue[0]}{parameter.unit ? ` ${parameter.unit}` : ""}
					</span>
				</div>
				<Slider
					value={sliderValue}
					onValueChange={setSliderValue}
					min={parameter.min}
					max={parameter.max}
					step={parameter.step}
				/>
			</div>
		);
	}

	if (parameter.type === "select") {
		const [selected, setSelected] = useState(parameter.defaultValue);
		return (
			<div>
				<Label className="mb-2 block text-[0.6875rem]">{parameter.name}</Label>
				<div className="flex gap-1.5">
					{parameter.options.map((option) => {
						const isActive = selected === option;
						return (
							<button
								key={option}
								onClick={() => setSelected(option)}
								className={cn(
									"rounded border-2 px-2.5 py-1 font-mono text-[0.625rem] uppercase transition-all",
									"bg-muted active:translate-y-px",
									isActive
										? "border-primary text-primary"
										: "border-border text-muted-foreground hover:text-foreground"
								)}
								style={{
									boxShadow: isActive
										? [
											'inset 0 2px 4px rgba(0,0,0,0.25)',
											'inset 0 1px 2px rgba(0,0,0,0.15)',
											'0 0 4px var(--color-primary)',
										].join(', ')
										: [
											'inset 0 2px 3px -1px rgba(255,255,255,0.15)',
											'inset 0 -2px 3px -1px rgba(0,0,0,0.25)',
											'0 1px 2px rgba(0,0,0,0.15)',
										].join(', '),
									textShadow: isActive
										? '0 0 6px var(--color-primary)'
										: undefined,
								}}
							>
								{option}
							</button>
						);
					})}
				</div>
			</div>
		);
	}

	if (parameter.type === "toggle") {
		return (
			<div className="flex items-center justify-between">
				<Label className="text-[0.6875rem]">{parameter.name}</Label>
				<Switch checked={toggleValue} onCheckedChange={setToggleValue} />
			</div>
		);
	}

	return (
		<div>
			<Label className="mb-2 block text-[0.6875rem]">{parameter.name}</Label>
			<div className="flex items-center gap-2">
				<Input
					type="number"
					className="h-7 w-24 font-mono text-xs"
					defaultValue={parameter.defaultValue}
					min={parameter.min}
					max={parameter.max}
				/>
				<span className="font-mono text-[0.625rem] text-muted-foreground">{parameter.unit}</span>
			</div>
		</div>
	);
}

function ModuleCard({ module, onToggleBypass }: { module: ModuleDefinition; onToggleBypass: () => void }) {
	const isBypassed = module.state === "bypassed" || module.state === "incomplete";
	const isIncomplete = module.state === "incomplete";

	return (
		<div className="relative">
			<div className={cn(
				"absolute left-1/2 -top-3 h-3 w-px",
				isBypassed ? "bg-border/30 border-dashed" : "bg-border"
			)} />

			<Popover>
				<PopoverTrigger asChild>
					<button
						className={cn(
							"w-72 card-outline text-left transition-colors",
							isBypassed &&"opacity-50",
						)}
					>
						<div className="flex w-full items-center gap-3 px-3 py-2.5">
							<Switch
								checked={!isBypassed}
								disabled={isIncomplete}
								onCheckedChange={(e) => { e.stopPropagation?.(); onToggleBypass(); }}
								onClick={(e) => e.stopPropagation()}
							/>
							<div className="flex flex-1 items-center gap-2">
								<span className={cn(
									"text-sm font-medium text-card-foreground",
									isBypassed &&"line-through text-muted-foreground",
								)}>
									{module.name}
								</span>
								{isIncomplete && (
									<span className="bg-[var(--color-status-warning)]/10 px-1.5 py-0.5 font-mono text-[0.5625rem] uppercase tracking-wider text-[var(--color-status-warning)]">
										incomplete
									</span>
								)}
							</div>
							<Settings className="h-3 w-3 text-muted-foreground" />
						</div>
					</button>
				</PopoverTrigger>
				<PopoverContent className="w-72" side="left" align="start">
					<div>
						<p className="mb-3 text-[0.6875rem] text-muted-foreground">{module.description}</p>
						{isIncomplete && (
							<div className="mb-3 flex items-center gap-2 border border-[var(--color-status-warning)]/30 bg-[var(--color-status-warning)]/5 px-2.5 py-2 text-[0.6875rem] text-[var(--color-status-warning)]">
								<AlertTriangle className="h-3 w-3 shrink-0" />
								Missing required reference file
							</div>
						)}
						<div className="space-y-5">
							{module.parameters.map((parameter) => (
								<ParameterControl key={parameter.name} parameter={parameter} />
							))}
						</div>
					</div>
				</PopoverContent>
			</Popover>

			<div className={cn(
				"absolute left-1/2 -bottom-3 h-3 w-px",
				isBypassed ? "bg-border/30" : "bg-border"
			)} />
		</div>
	);
}

function SignalFlowNode({ icon: Icon, label }: { icon: typeof FileAudio; label: string }) {
	return (
		<div className="flex items-center gap-2 border border-border bg-muted px-3 py-2">
			<Icon className="h-3.5 w-3.5 text-muted-foreground" />
			<span className="font-mono text-xs text-muted-foreground">{label}</span>
		</div>
	);
}

export function Processing() {
	const [chain, setChain] = useState(DEMO_CHAIN);

	const toggleBypass = (index: number) => {
		setChain((prev) =>
			prev.map((m, i) =>
				i === index ? { ...m, state: m.state === "bypassed" ? "active" : "bypassed" } : m
			)
		);
	};

	return (
		<div className="space-y-8">
			<div>
				<h4 className="mb-4 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Signal Flow — Chain Visualization
				</h4>
				<div className="flex flex-col items-center gap-3">
					<SignalFlowNode icon={FileAudio} label="Source: voice_recording.wav" />
					<div className="h-3 w-px bg-border" />
					{chain.map((module, index) => (
						<ModuleCard key={module.name} module={module} onToggleBypass={() => toggleBypass(index)} />
					))}
					<div className="h-3 w-px bg-border" />
					<SignalFlowNode icon={Download} label="Output: processed.wav" />
				</div>
			</div>

			<div className="h-px bg-border" />

			<div>
				<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Module States
				</h4>
				<div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
					<div className="flex items-center gap-2">
						<div className="h-3 w-3 card-outline" />
						<span>Active</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="h-3 w-3 card-outline opacity-50" />
						<span>Bypassed</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="h-3 w-3 border border-[var(--color-status-warning)]/60" />
						<span>Incomplete</span>
					</div>
				</div>
			</div>
		</div>
	);
}
