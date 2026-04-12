import { useCallback, useMemo, useRef } from "react";
import { IconButton, Select } from "@e9g/design-system";
import type { SnapshotContext } from "../../../models/Context";
import type { PlaybackState } from "../../../models/State/Playback";
import type { Transient } from "../../../models/Transient";
import { useTransients } from "../../../hooks/useTransients";

interface Props {
	readonly context: SnapshotContext;
}

function formatMs(ms: number): string {
	const totalSeconds = Math.max(0, ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = Math.floor(totalSeconds % 60);
	const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);

	return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

const PLAYBACK_RATES = ["0.25x", "0.5x", "1x", "1.5x", "2x", "4x"];
const ALGORITHMS: ReadonlyArray<string> = ["log", "mel", "ERB", "linear"];
const FFT_SIZES: ReadonlyArray<string> = ["1024", "2048", "4096", "8192"];

export function SpectralTransport({ context }: Props) {
	const timeRef = useRef<HTMLSpanElement>(null);

	const { snapshot, snapshotStore, playback, playbackEngine, wavFile } = context;

	const playbackProxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<PlaybackState>(playback._key),
		[snapshotStore, playback._key],
	);

	const currentMsTransient = playbackProxy?.currentMs;

	const updateTime = useCallback(() => {
		if (!timeRef.current || !currentMsTransient) return;

		timeRef.current.textContent = formatMs(currentMsTransient.value);
	}, [currentMsTransient]);

	const transients = useMemo(
		() => (currentMsTransient ? [currentMsTransient as Transient<unknown>] : []),
		[currentMsTransient],
	);

	useTransients(transients, updateTime);

	const totalMs = wavFile.durationMs;

	const handlePlayPause = useCallback(() => {
		if (playback.isPlaying) {
			playbackEngine.pause();
		} else {
			void playbackEngine.play();
		}
	}, [playback.isPlaying, playbackEngine]);

	const handleStop = useCallback(() => {
		playbackEngine.stop();
	}, [playbackEngine]);

	const handleSkipBack = useCallback(() => {
		const current = currentMsTransient?.value ?? 0;

		playbackEngine.seek(Math.max(0, current - 5000));
	}, [playbackEngine, currentMsTransient]);

	const handleSkipForward = useCallback(() => {
		const current = currentMsTransient?.value ?? 0;

		playbackEngine.seek(Math.min(totalMs, current + 5000));
	}, [playbackEngine, currentMsTransient, totalMs]);

	const handleSkipToStart = useCallback(() => {
		playbackEngine.seek(0);
	}, [playbackEngine]);

	const handleSkipToEnd = useCallback(() => {
		playbackEngine.seek(totalMs);
	}, [playbackEngine, totalMs]);

	const handleVolumeChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			playbackEngine.setVolume(parseFloat(event.target.value));
		},
		[playbackEngine],
	);

	const handleRateSelect = useCallback(
		(value: string) => {
			const rate = parseFloat(value);

			playbackEngine.setPlaybackRate(rate);
		},
		[playbackEngine],
	);

	const handleLoopToggle = useCallback(() => {
		snapshotStore.mutate(playback, (proxy) => {
			proxy.isLooping = !proxy.isLooping;
		});
	}, [snapshotStore, playback]);

	const handleAlgorithmSelect = useCallback(
		(value: string) => {
			snapshotStore.mutate(snapshot, (proxy) => {
				(proxy as unknown as { spectrogramAlgorithm: string }).spectrogramAlgorithm = value;
			});
		},
		[snapshotStore, snapshot],
	);

	const handleFftSizeSelect = useCallback(
		(value: string) => {
			snapshotStore.mutate(snapshot, (proxy) => {
				(proxy as unknown as { fftSize: number }).fftSize = parseInt(value, 10);
			});
		},
		[snapshotStore, snapshot],
	);

	const handleDbRangeChange = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			snapshotStore.mutate(snapshot, (proxy) => {
				(proxy as unknown as { dbRange: number }).dbRange = parseInt(event.target.value, 10);
			});
		},
		[snapshotStore, snapshot],
	);

	return (
		<div className="flex h-10 shrink-0 items-center bg-void px-3 font-technical">
			{/* Left: Time display */}
			<div className="flex shrink-0 items-center gap-1 text-sm tabular-nums text-chrome-text">
				<span ref={timeRef}>{formatMs(playback.currentMs.value)}</span>
				<span className="text-chrome-text-dim">/</span>
				<span className="text-chrome-text-secondary">{formatMs(totalMs)}</span>
			</div>

			{/* Center: Media controls */}
			<div className="flex flex-1 items-center justify-center gap-0.5">
				<IconButton icon="lucide:skip-back" label="Skip to start" size={14} variant="ghost" onClick={handleSkipToStart} />
				<IconButton icon="lucide:chevrons-left" label="Skip back 5s" size={14} variant="ghost" onClick={handleSkipBack} />
				<IconButton
					icon={playback.isPlaying ? "lucide:pause" : "lucide:play"}
					label={playback.isPlaying ? "Pause" : "Play"}
					size={18}
					variant="ghost"
					onClick={handlePlayPause}
				/>
				<IconButton icon="lucide:square" label="Stop" size={14} variant="ghost" onClick={handleStop} />
				<IconButton icon="lucide:chevrons-right" label="Skip forward 5s" size={14} variant="ghost" onClick={handleSkipForward} />
				<IconButton icon="lucide:skip-forward" label="Skip to end" size={14} variant="ghost" onClick={handleSkipToEnd} />

				<div className="mx-1 h-4 w-px bg-chrome-border-subtle" />

				<IconButton
					icon="lucide:repeat"
					label="Loop"
					size={14}
					variant="ghost"
					active={playback.isLooping}
					activeVariant="primary"
					onClick={handleLoopToggle}
				/>

				<div className="mx-1 h-4 w-px bg-chrome-border-subtle" />

				<input
					type="range"
					min={0}
					max={1}
					step={0.01}
					defaultValue={playback.volume}
					onChange={handleVolumeChange}
					className="h-1 w-16 accent-primary"
					aria-label="Volume"
				/>

				<div className="mx-1 h-4 w-px bg-chrome-border-subtle" />

				<Select
					value={`${playback.playbackRate}x`}
					options={PLAYBACK_RATES}
					onSelect={handleRateSelect}
				/>
			</div>

			{/* Right: Spectral controls */}
			<div className="flex shrink-0 items-center gap-2">
				<Select
					value={snapshot.spectrogramAlgorithm}
					options={ALGORITHMS as unknown as ReadonlyArray<string>}
					onSelect={handleAlgorithmSelect}
				/>
				<Select
					value={String(snapshot.fftSize)}
					options={FFT_SIZES as unknown as ReadonlyArray<string>}
					onSelect={handleFftSizeSelect}
				/>
				<div className="flex items-center gap-1">
					<span className="text-xs uppercase tracking-[0.06em] text-chrome-text-dim">dB</span>
					<input
						type="range"
						min={30}
						max={150}
						step={1}
						defaultValue={snapshot.dbRange}
						onChange={handleDbRangeChange}
						className="h-1 w-16 accent-primary"
						aria-label="dB range"
					/>
				</div>
			</div>
		</div>
	);
}
