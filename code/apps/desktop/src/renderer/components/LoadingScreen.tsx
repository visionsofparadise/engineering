import { useEffect, useRef, useState } from "react";
import { Check, Clock, LoaderCircle, X } from "lucide-react";
import type { AppContext } from "../models/Context";
import type { ModulePackageState } from "../models/State/App";
import { cn } from "../utils/cn";
import { TitleBar } from "./TitleBar";
import { Button } from "./ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";

interface LoadingScreenProps {
	readonly context: AppContext;
	readonly onRetry: (index: number) => void;
	readonly onContinue: () => void;
}

type OverallStatus = "loading" | "complete" | "error";
type PackageStatus = ModulePackageState["status"];

const STEPS = ["cloning", "building", "loading", "ready"] as const;
const TOTAL_STEPS = STEPS.length;

function getOverallStatus(packages: ReadonlyArray<ModulePackageState>): OverallStatus {
	const allDone = packages.every((entry) => entry.status === "ready" || entry.status === "skipped" || entry.status === "error");

	if (!allDone) return "loading";

	return packages.some((entry) => entry.status === "error") ? "error" : "complete";
}

function getStepProgress(status: PackageStatus): { step: number; progress: number } {
	switch (status) {
		case "pending":
			return { step: 0, progress: 0 };
		case "cloning":
			return { step: 1, progress: 1 / TOTAL_STEPS };
		case "building":
			return { step: 2, progress: 2 / TOTAL_STEPS };
		case "loading":
			return { step: 3, progress: 3 / TOTAL_STEPS };
		case "ready":
		case "skipped":
			return { step: TOTAL_STEPS, progress: 1 };
		case "error":
			return { step: 0, progress: 0 };
	}
}

const STATUS_BADGE_CONFIG: Record<PackageStatus, { label: string; className: string }> = {
	pending: { label: "Queued", className: "bg-[var(--color-status-queued)]/20 text-[var(--color-status-queued)]" },
	cloning: { label: "Cloning", className: "bg-[var(--color-status-processing)]/20 text-[var(--color-status-processing)]" },
	building: { label: "Building", className: "bg-[var(--color-status-processing)]/20 text-[var(--color-status-processing)]" },
	loading: { label: "Loading", className: "bg-[var(--color-status-processing)]/20 text-[var(--color-status-processing)]" },
	ready: { label: "Ready", className: "bg-[var(--color-status-complete)]/20 text-[var(--color-status-complete)]" },
	skipped: { label: "Skipped", className: "bg-[var(--color-status-queued)]/20 text-[var(--color-status-queued)]" },
	error: { label: "Error", className: "bg-[var(--color-status-error)]/20 text-[var(--color-status-error)]" },
};

const OVERALL_BADGE_CONFIG: Record<OverallStatus, { label: string; className: string }> = {
	loading: { label: "Loading", className: "bg-[var(--color-status-processing)]/20 text-[var(--color-status-processing)]" },
	complete: { label: "Complete", className: "bg-[var(--color-status-complete)]/20 text-[var(--color-status-complete)]" },
	error: { label: "Error", className: "bg-[var(--color-status-error)]/20 text-[var(--color-status-error)]" },
};

function StatusBadge({ label, className }: { readonly label: string; readonly className: string }) {
	return (
		<span className={cn("px-1.5 py-0.5 font-mono text-[0.5625rem] uppercase tracking-wider", className)}>
			{label}
		</span>
	);
}

function ProgressBar({ progress, status }: { readonly progress: number; readonly status: OverallStatus | "pending" | "running" }) {
	const barColor = {
		pending: "bg-[var(--color-status-queued)]/30",
		loading: "bg-[var(--color-status-processing)]",
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

function PackageStatusIcon({ status }: { readonly status: PackageStatus }) {
	if (status === "pending") return <div className="h-3 w-3 rounded-full border border-muted-foreground/30" />;
	if (status === "ready" || status === "skipped") return <Check className="h-3 w-3 text-[var(--color-status-complete)]" />;
	if (status === "error") return <X className="h-3 w-3 text-[var(--color-status-error)]" />;

	return <LoaderCircle className="h-3 w-3 animate-spin text-[var(--color-status-processing)]" />;
}

function useElapsed(stopped: boolean) {
	const [elapsed, setElapsed] = useState(0);
	const start = useRef(Date.now());
	const frozen = useRef<number | null>(null);

	useEffect(() => {
		if (stopped) {
			frozen.current ??= Math.floor((Date.now() - start.current) / 1000);

			return;
		}

		const interval = setInterval(() => {
			setElapsed(Math.floor((Date.now() - start.current) / 1000));
		}, 1000);

		return () => clearInterval(interval);
	}, [stopped]);

	return frozen.current ?? elapsed;
}

function usePackageTimers(packages: ReadonlyArray<ModulePackageState>) {
	const [times, setTimes] = useState<Record<string, number>>({});
	const starts = useRef<Record<string, number>>({});

	useEffect(() => {
		for (const bundle of packages) {
			if (bundle.status !== "pending" && !starts.current[bundle.directory]) {
				starts.current[bundle.directory] = Date.now();
			}
		}

		const interval = setInterval(() => {
			const now = Date.now();
			const updated: Record<string, number> = {};

			for (const bundle of packages) {
				const start = starts.current[bundle.directory];

				if (!start) continue;

				if (bundle.status === "ready" || bundle.status === "skipped" || bundle.status === "error") {
					updated[bundle.directory] = times[bundle.directory] ?? Math.floor((now - start) / 1000);
				} else {
					updated[bundle.directory] = Math.floor((now - start) / 1000);
				}
			}

			setTimes(updated);
		}, 1000);

		return () => clearInterval(interval);
	}, [packages, times]);

	return times;
}

function formatElapsed(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;

	const min = Math.floor(seconds / 60);
	const sec = seconds % 60;

	return `${min}m ${sec}s`;
}

function PackageRow({ bundle, index, elapsed, onRetry }: { readonly bundle: ModulePackageState; readonly index: number; readonly elapsed: number | undefined; readonly onRetry: (index: number) => void }) {
	const { step, progress } = getStepProgress(bundle.status);
	const isDone = bundle.status === "ready" || bundle.status === "skipped";
	const isError = bundle.status === "error";
	const isPending = bundle.status === "pending";
	const barStatus = isDone ? "complete" : isError ? "error" : isPending ? "pending" : "running";
	const badge = STATUS_BADGE_CONFIG[bundle.status];

	return (
		<div className="grid grid-cols-[auto_1fr_auto_auto_5rem_auto] items-center gap-3 py-1.5">
			<PackageStatusIcon status={bundle.status} />
			<span
				className={cn(
					"min-w-0 truncate text-[0.6875rem]",
					isPending ? "text-muted-foreground/50" : "text-foreground",
				)}
			>
				{bundle.directory}
			</span>
			<div className="flex items-center gap-2">
				{isError && (
					<Button
						variant="ghost"
						size="sm"
						className="h-6 px-2 text-[0.625rem]"
						onClick={() => onRetry(index)}
					>
						Retry
					</Button>
				)}
				{isError && bundle.error ? (
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<StatusBadge label={badge.label} className={badge.className} />
							</TooltipTrigger>
							<TooltipContent side="bottom" className="max-w-sm">
								<pre className="select-text whitespace-pre-wrap font-mono text-[0.625rem]">{bundle.error}</pre>
							</TooltipContent>
						</Tooltip>
					</TooltipProvider>
				) : (
					<StatusBadge label={isDone || isError ? badge.label : `${badge.label} ${step}/${TOTAL_STEPS}`} className={badge.className} />
				)}
			</div>
			<div className="w-20">
				<ProgressBar progress={progress} status={barStatus} />
			</div>
			<span className="text-right font-mono text-[0.625rem] tabular-nums text-muted-foreground">
				{elapsed !== undefined ? formatElapsed(elapsed) : "—"}
			</span>
			<Clock className="h-3 w-3 text-muted-foreground" />
		</div>
	);
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ context, onRetry, onContinue }) => {
	const packages = context.app.packages;
	const overallStatus = getOverallStatus(packages);
	const elapsed = useElapsed(overallStatus !== "loading");
	const packageTimes = usePackageTimers(packages);

	const completedCount = packages.filter((entry) => entry.status === "ready" || entry.status === "skipped" || entry.status === "error").length;
	const totalCount = packages.length;
	const progress = totalCount > 0 ? completedCount / totalCount : 0;
	const isFirstRun = packages.some((entry) => entry.status === "cloning" || entry.status === "building");
	const overallBadge = OVERALL_BADGE_CONFIG[overallStatus];

	return (
		<div className="flex h-screen flex-col surface-panel">
			<TitleBar />

			<div className="flex flex-1 items-center justify-center">
			<div
				className={cn(
					"flex max-h-[80vh] w-full max-w-lg flex-col border bg-card",
					overallStatus === "error" ? "border-destructive/30" : "border-border",
				)}
			>
				{/* Header */}
				<div className="grid grid-cols-[1fr_auto_auto_5rem_auto] items-center gap-3 px-4 py-3">
					<span className="text-sm font-medium text-foreground">Loading packages</span>
					<StatusBadge label={overallBadge.label} className={overallBadge.className} />
					<div className="w-20">
						<ProgressBar progress={progress} status={overallStatus} />
					</div>
					<span className="text-right font-mono text-[0.625rem] tabular-nums text-muted-foreground">
						{formatElapsed(elapsed)}
					</span>
					<Clock className="h-3 w-3 text-muted-foreground" />
				</div>

				{/* Package list */}
				<div className="overflow-y-auto border-t border-border/50 px-4 pb-3 pt-2">
					{packages.map((bundle, index) => (
						<PackageRow
							key={bundle.directory}
							bundle={bundle}
							index={index}
							elapsed={packageTimes[bundle.directory]}
							onRetry={onRetry}
						/>
					))}
					{packages.length === 0 && (
						<div className="py-4 text-center text-sm text-muted-foreground">
							No packages configured
						</div>
					)}
				</div>

				{/* First-run notice */}
				{isFirstRun && (
					<div className="px-4 py-2 text-[0.6875rem] text-muted-foreground">
						First-time setup — cloning and building are only needed once per package.
					</div>
				)}

				{/* Continue button for error state */}
				{overallStatus === "error" && (
					<div className="flex justify-end border-t border-border/50 px-4 py-3">
						<Button className="surface-primary" onClick={onContinue}>
							Continue
						</Button>
					</div>
				)}
			</div>
		</div>
		</div>
	);
};
