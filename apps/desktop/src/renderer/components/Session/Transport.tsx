import { Download, FastForward, Loader2, Pause, Play, Repeat, Rewind, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTransients } from "../../hooks/useTransients";
import type { SessionContext } from "../../models/Context";
import { resnapshot } from "../../models/ProxyStore/resnapshot";
import { formatTime } from "../../utils/time";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Slider } from "../ui/slider";
import { ExportModal, type ExportSettings } from "./Export/ExportModal";
import { useExport } from "./Export/hooks/useExport";

interface TransportProps {
	readonly context: SessionContext;
}

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.5, 2, 4] as const;

export const Transport: React.FC<TransportProps> = resnapshot(({ context }) => {
	const { playback, playbackEngine } = context;
	const [prevVolume, setPrevVolume] = useState(1);
	const [exportOpen, setExportOpen] = useState(false);
	const { exporting, progress, startExport } = useExport(context);
	const timeRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		const handleOpenExport = () => setExportOpen(true);
		window.addEventListener("open-export-modal", handleOpenExport);

		return () => window.removeEventListener("open-export-modal", handleOpenExport);
	}, []);

	useTransients([playback.currentMs], () => {
		if (timeRef.current) {
			timeRef.current.textContent = formatTime(playback.currentMs.value);
		}
	});

	const handlePlayPause = useCallback(() => {
		if (playback.isPlaying) {
			playbackEngine.pause();
		} else {
			void playbackEngine.play();
		}
	}, [playback.isPlaying, playbackEngine]);

	const handleSkipToStart = useCallback(() => {
		playbackEngine.skipToStart();
	}, [playbackEngine]);

	const handleSkipToEnd = useCallback(() => {
		playbackEngine.skipToEnd();
	}, [playbackEngine]);

	const handleSkipBackward = useCallback(() => {
		playbackEngine.skipBackward(5000);
	}, [playbackEngine]);

	const handleSkipForward = useCallback(() => {
		playbackEngine.skipForward(5000);
	}, [playbackEngine]);

	const handleVolumeChange = useCallback(
		(value: Array<number>) => {
			playbackEngine.setVolume((value[0] ?? 100) / 100);
		},
		[playbackEngine],
	);

	const handleMuteToggle = useCallback(() => {
		if (playback.volume > 0) {
			setPrevVolume(playback.volume);
			playbackEngine.setVolume(0);
		} else {
			playbackEngine.setVolume(prevVolume);
		}
	}, [playback.volume, prevVolume, playbackEngine]);

	const handleRateChange = useCallback(
		(value: string) => {
			playbackEngine.setPlaybackRate(parseFloat(value));
		},
		[playbackEngine],
	);

	const handleLoopToggle = useCallback(() => {
		playbackEngine.setIsLooping(!playback.isLooping);
	}, [playback.isLooping, playbackEngine]);

	const handleExportSettings = useCallback(
		(settings: ExportSettings) => {
			setExportOpen(false);

			void startExport(settings);
		},
		[startExport],
	);

	const durationMs = playbackEngine.durationMs;

	const volumePercent = Math.round(playback.volume * 100);

	return (
		<div className="flex h-14 items-center border-t border-border bg-[var(--surface-panel-header)] px-6">
			<div className="flex flex-1 items-center gap-8">
				<span className="font-mono text-xs tabular-nums text-muted-foreground">
					<span ref={timeRef}>{formatTime(0)}</span>
					{" / "}
					{formatTime(durationMs)}
				</span>
				<Select value={String(playback.playbackRate)} onValueChange={handleRateChange}>
					<SelectTrigger className="w-20">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PLAYBACK_RATES.map((rate) => (
							<SelectItem key={rate} value={String(rate)}>
								{rate}x
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			<div className="flex items-center gap-1">
				<Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSkipToStart}>
					<SkipBack className="h-4 w-4" />
				</Button>
				<Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSkipBackward}>
					<Rewind className="h-4 w-4" />
				</Button>
				<Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePlayPause}>
					{playback.isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
				</Button>
				<Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSkipForward}>
					<FastForward className="h-4 w-4" />
				</Button>
				<Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleSkipToEnd}>
					<SkipForward className="h-4 w-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className={`h-8 w-8 ${playback.isLooping ? "text-primary" : ""}`}
					onClick={handleLoopToggle}
				>
					<Repeat className="h-4 w-4" />
				</Button>
			</div>

			<div className="flex flex-1 items-center justify-end gap-8">
				<div className="flex items-center gap-2">
					<button
						onClick={handleMuteToggle}
						className="text-muted-foreground hover:text-foreground"
					>
						{playback.volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
					</button>
					<div className="w-32">
						<Slider
							min={0}
							max={100}
							step={1}
							value={[volumePercent]}
							onValueChange={handleVolumeChange}
							ticks={4}
						/>
					</div>
					<span className="w-8 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{volumePercent}%</span>
				</div>
				<Button
					className="surface-primary gap-2"
					disabled={exporting}
					onClick={() => setExportOpen(true)}
				>
					{exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
					{exporting ? `${Math.round(progress * 100)}%` : "Export"}
				</Button>
			</div>

			<ExportModal
				open={exportOpen}
				onOpenChange={setExportOpen}
				onExport={handleExportSettings}
			/>
		</div>
	);
});
