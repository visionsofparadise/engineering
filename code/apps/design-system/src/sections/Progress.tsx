import { useState } from "react";
import { ChevronDown, ChevronRight, Check, X, LoaderCircle, Clock } from "lucide-react";
import { cn } from "../utils/cn";
import { InstrumentPanel, InstrumentReadout } from "../components/InstrumentPanel";

type JobStatus = "queued" | "processing" | "complete" | "error";
type TransformStatus = "pending" | "running" | "complete" | "error";

interface TransformStep {
	name: string;
	status: TransformStatus;
	progress: number;
	samplesPerSecond: number | null;
	realTimeMultiplier: number | null;
}

interface JobDefinition {
	fileName: string;
	status: JobStatus;
	overallProgress: number;
	elapsed: string;
	eta: string | null;
	totalTime: string | null;
	realTimeMultiplier: number | null;
	transforms: Array<TransformStep>;
	errorMessage: string | null;
}

const DEMO_JOBS: Array<JobDefinition> = [
	{
		fileName: "interview_final_v3.wav",
		status: "complete",
		overallProgress: 1,
		elapsed: "12.4s",
		eta: null,
		totalTime: "12.4s",
		realTimeMultiplier: 6.2,
		transforms: [
			{ name: "Voice Denoise", status: "complete", progress: 1, samplesPerSecond: 148200, realTimeMultiplier: 3.1 },
			{ name: "De-Click", status: "complete", progress: 1, samplesPerSecond: 384000, realTimeMultiplier: 8.0 },
			{ name: "Loudness", status: "complete", progress: 1, samplesPerSecond: 672000, realTimeMultiplier: 14.0 },
			{ name: "EQ Match", status: "complete", progress: 1, samplesPerSecond: 211200, realTimeMultiplier: 4.4 },
		],
		errorMessage: null,
	},
	{
		fileName: "podcast_ep47_raw.wav",
		status: "processing",
		overallProgress: 0.58,
		elapsed: "8.1s",
		eta: "~5.8s",
		totalTime: null,
		realTimeMultiplier: 4.8,
		transforms: [
			{ name: "Voice Denoise", status: "complete", progress: 1, samplesPerSecond: 153600, realTimeMultiplier: 3.2 },
			{ name: "De-Click", status: "complete", progress: 1, samplesPerSecond: 384000, realTimeMultiplier: 8.0 },
			{ name: "Loudness", status: "running", progress: 0.32, samplesPerSecond: 518400, realTimeMultiplier: 10.8 },
			{ name: "EQ Match", status: "pending", progress: 0, samplesPerSecond: null, realTimeMultiplier: null },
		],
		errorMessage: null,
	},
	{
		fileName: "voiceover_take_12.wav",
		status: "queued",
		overallProgress: 0,
		elapsed: "—",
		eta: null,
		totalTime: null,
		realTimeMultiplier: null,
		transforms: [
			{ name: "Voice Denoise", status: "pending", progress: 0, samplesPerSecond: null, realTimeMultiplier: null },
			{ name: "Loudness", status: "pending", progress: 0, samplesPerSecond: null, realTimeMultiplier: null },
		],
		errorMessage: null,
	},
	{
		fileName: "corrupted_file.wav",
		status: "error",
		overallProgress: 0.25,
		elapsed: "3.2s",
		eta: null,
		totalTime: null,
		realTimeMultiplier: null,
		transforms: [
			{ name: "Voice Denoise", status: "complete", progress: 1, samplesPerSecond: 148200, realTimeMultiplier: 3.1 },
			{ name: "De-Click", status: "error", progress: 0.45, samplesPerSecond: null, realTimeMultiplier: null },
			{ name: "Loudness", status: "pending", progress: 0, samplesPerSecond: null, realTimeMultiplier: null },
		],
		errorMessage: "De-Click failed: Invalid sample data at offset 0x1A3F (NaN detected)",
	},
];

function StatusBadge({ status }: { status: JobStatus }) {
	const config = {
		queued: { label: "Queued", className: "bg-[var(--color-status-queued)]/20 text-[var(--color-status-queued)]" },
		processing: { label: "Processing", className: "bg-[var(--color-status-processing)]/20 text-[var(--color-status-processing)]" },
		complete: { label: "Complete", className: "bg-[var(--color-status-complete)]/20 text-[var(--color-status-complete)]" },
		error: { label: "Error", className: "bg-[var(--color-status-error)]/20 text-[var(--color-status-error)]" },
	};

	const { label, className } = config[status];

	return (
		<span className={cn(" px-1.5 py-0.5 font-mono text-[0.5625rem] uppercase tracking-wider", className)}>
			{label}
		</span>
	);
}

function ProgressBar({ progress, status }: { progress: number; status: JobStatus | TransformStatus }) {
	const barColor = {
		queued: "bg-[var(--color-status-queued)]/30",
		pending: "bg-[var(--color-status-queued)]/30",
		processing: "bg-[var(--color-status-processing)]",
		running: "bg-[var(--color-status-processing)]",
		complete: "bg-[var(--color-status-complete)]",
		error: "bg-[var(--color-status-error)]",
	};

	return (
		<div className="h-1 w-full overflow-hidden rounded-full bg-muted">
			<div
				className={cn("h-full rounded-full transition-all", barColor[status])}
				style={{ width: `${progress * 100}%` }}
			/>
		</div>
	);
}

function TransformStatusIcon({ status }: { status: TransformStatus }) {
	if (status === "pending") return <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />;
	if (status === "running") return <LoaderCircle className="h-3 w-3 animate-spin text-[var(--color-status-processing)]" />;
	if (status === "complete") return <Check className="h-3 w-3 text-[var(--color-status-complete)]" />;
	return <X className="h-3 w-3 text-[var(--color-status-error)]" />;
}

function TransformRow({ transform }: { transform: TransformStep }) {
	return (
		<div className="flex items-center gap-3 py-1.5">
			<TransformStatusIcon status={transform.status} />
			<span className={cn(
				"w-28 text-[0.6875rem]",
				transform.status === "pending" ? "text-muted-foreground/50" : "text-foreground",
			)}>
				{transform.name}
			</span>
			<div className="w-24">
				<ProgressBar progress={transform.progress} status={transform.status} />
			</div>
			<span className="w-20 text-right font-mono text-[0.625rem] tabular-nums text-muted-foreground">
				{transform.realTimeMultiplier !== null ? `${transform.realTimeMultiplier.toFixed(1)}x rt` : "—"}
			</span>
			<span className="w-20 text-right font-mono text-[0.625rem] tabular-nums text-muted-foreground">
				{transform.samplesPerSecond !== null
					? `${(transform.samplesPerSecond / 1000).toFixed(0)}k smp/s`
					: "—"}
			</span>
		</div>
	);
}

function JobCard({ job }: { job: JobDefinition }) {
	const [expanded, setExpanded] = useState(job.status === "processing" || job.status === "error");

	return (
		<div className={cn(
			" border bg-card",
			job.status === "error" ? "border-destructive/30" : "border-border",
		)}>
			<button
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-center gap-3 px-4 py-3 text-left"
			>
				<div className="flex items-center gap-1 text-muted-foreground">
					{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				</div>
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{job.fileName}</span>
				<StatusBadge status={job.status} />
				<div className="w-24">
					<ProgressBar progress={job.overallProgress} status={job.status} />
				</div>
				<div className="flex items-center gap-1.5 text-muted-foreground">
					<Clock className="h-3 w-3" />
					<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">
						{job.totalTime ?? job.elapsed}
					</span>
				</div>
				{job.realTimeMultiplier !== null && (
					<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">
						{job.realTimeMultiplier.toFixed(1)}x
					</span>
				)}
				{job.eta !== null && (
					<span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">
						ETA {job.eta}
					</span>
				)}
			</button>

			<div
				className={cn(
					"grid transition-[grid-template-rows] duration-[var(--duration-ui)] ease-out",
					expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
				)}
			>
				<div className="overflow-hidden">
					<div className="border-t border-border/50 px-4 pb-3 pt-2">
						<div className="pl-6">
							{job.transforms.map((transform) => (
								<TransformRow key={transform.name} transform={transform} />
							))}
						</div>
						{job.errorMessage !== null && (
							<div className="mt-2 bg-destructive/10 px-3 py-2">
								<span className="font-mono text-[0.625rem] text-[var(--color-status-error)]">{job.errorMessage}</span>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

function BatchOverview() {
	const completedCount = DEMO_JOBS.filter((job) => job.status === "complete").length;
	const totalCount = DEMO_JOBS.length;
	const hasErrors = DEMO_JOBS.some((job) => job.status === "error");
	const errorCount = DEMO_JOBS.filter((job) => job.status === "error").length;

	return (
		<InstrumentPanel>
			<InstrumentReadout label="Files" value={`${completedCount} / ${totalCount}`} />
			<InstrumentReadout label="Elapsed" value="23.7" unit="seconds" />
			<InstrumentReadout label="Remaining" value="~12" unit="seconds" />
			{hasErrors && (
				<InstrumentReadout
					label="Errors"
					value={String(errorCount)}
					valueClassName="mt-1.5 font-mono text-lg tabular-nums leading-none text-[var(--color-status-error)]"
				/>
			)}
		</InstrumentPanel>
	);
}

export function Progress() {
	return (
		<div className="space-y-6">
			<div>
				<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Batch Overview
				</h4>
				<BatchOverview />
			</div>

			<div>
				<h4 className="mb-3 font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">
					Job Queue
				</h4>
				<div className="space-y-2">
					{DEMO_JOBS.map((job) => (
						<JobCard key={job.fileName} job={job} />
					))}
				</div>
			</div>
		</div>
	);
}
