import { Loader2, CheckCircle2, AlertCircle, SkipForward } from "lucide-react";
import type { AppContext } from "../models/Context";
import type { ModulePackageState } from "../models/State/App";
import { Button } from "./ui/button";

interface LoadingScreenProps {
	readonly context: AppContext;
	readonly onSkip: (index: number) => void;
}

function StatusIcon({ status }: { readonly status: ModulePackageState["status"] }) {
	switch (status) {
		case "ready":
			return <CheckCircle2 className="h-4 w-4 text-green-500" />;
		case "error":
			return <AlertCircle className="h-4 w-4 text-yellow-500" />;
		case "skipped":
			return <SkipForward className="h-4 w-4 text-muted-foreground" />;
		case "pending":
			return <div className="h-4 w-4 rounded-full border border-muted-foreground/30" />;
		default:
			return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
	}
}

function statusLabel(status: ModulePackageState["status"]): string {
	switch (status) {
		case "pending":
			return "Waiting...";
		case "cloning":
			return "Cloning...";
		case "building":
			return "Building...";
		case "loading":
			return "Loading modules...";
		case "ready":
			return "Ready";
		case "skipped":
			return "Skipped";
		case "error":
			return "Error";
	}
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ context, onSkip }) => {
	const packages = context.app.packages;

	return (
		<div className="flex h-screen flex-col items-center justify-center gap-6 bg-background">
			<div className="text-sm text-muted-foreground">Loading packages...</div>
			<div className="flex w-80 flex-col gap-2">
				{packages.map((packageState, index) => (
					<div
						key={packageState.directory}
						className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
					>
						<StatusIcon status={packageState.status} />
						<div className="flex flex-1 flex-col">
							<span className="text-xs font-medium">{packageState.directory}</span>
							<span className="text-[10px] text-muted-foreground">
								{packageState.error ?? statusLabel(packageState.status)}
							</span>
						</div>
						{packageState.status !== "ready" && packageState.status !== "skipped" && packageState.status !== "error" && packageState.status !== "pending" && (
							<Button
								variant="ghost"
								size="sm"
								className="h-6 text-[10px]"
								onClick={() => onSkip(index)}
							>
								Skip
							</Button>
						)}
					</div>
				))}
			</div>
		</div>
	);
};
