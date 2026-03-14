import { useMemo, useState } from "react";
import { InstrumentPanel, InstrumentReadout } from "../components/InstrumentPanel";
import type { ColormapFn } from "../components/workspace/SpectrogramCanvas";
import { SpectrogramCanvas } from "../components/workspace/SpectrogramCanvas";
import { lavaColor } from "../components/workspace/utils/lava";
import { viridisColor } from "../components/workspace/utils/viridis";
import { WaveformCanvas } from "../components/workspace/WaveformCanvas";
import { generateStereoSpectrogramData } from "../data/spectrogram";
import { generateStereoWaveformData } from "../data/waveform";

const LANE_WIDTH = 800;
const LANE_HEIGHT = 140;
const RULER_HEIGHT = 32;
const FREQ_AXIS_WIDTH = 52;
const AMP_AXIS_WIDTH = 44;
const DURATION_SECONDS = 10;
const NUM_FRAMES = 512;
const NUM_BINS = 256;
const POINTS_PER_SECOND = 200;
const DB_RANGE = [-80, 0] as const;
const PLAYHEAD_POSITION = 0.4;

const FREQ_LABELS = ["20k", "10k", "5k", "2k", "1k", "500", "200", "100", "20"];
const AMP_LABELS = ["0", "-6", "-12", "-18", "-24", "-48"];

const DEFAULT_COLORMAP = { id: "viridis", label: "Viridis", colorFn: viridisColor, waveColor: "rgb(255, 160, 60)" };

const COLORMAPS = [
	DEFAULT_COLORMAP,
	{ id: "lava", label: "Lava", colorFn: lavaColor, waveColor: "rgb(56, 189, 248)" },
];

function TimeRuler({ width }: { width: number }) {
	const majorCount = 11;
	const subdivisionsPerMajor = 5;

	const majorTicks = Array.from({ length: majorCount }, (_, tickIndex) => tickIndex);
	const minorTicks: Array<{ x: number }> = [];

	for (let major = 0; major < majorCount - 1; major++) {
		for (let sub = 1; sub < subdivisionsPerMajor; sub++) {
			const frac = (major + sub / subdivisionsPerMajor) / (majorCount - 1);
			minorTicks.push({ x: frac * width });
		}
	}

	return (
		<div className="relative flex-shrink-0" style={{ width, height: RULER_HEIGHT }}>
			<div className="absolute bottom-0 left-0 right-0 h-px bg-border/50" />
			{minorTicks.map((tick, tickIndex) => (
				<div
					key={`minor-${tickIndex}`}
					className="absolute bottom-0 w-px bg-muted-foreground/30"
					style={{ left: tick.x, height: 6 }}
				/>
			))}
			{majorTicks.map((index) => {
				const tickX = (index / (majorCount - 1)) * width;
				const seconds = (index / (majorCount - 1)) * DURATION_SECONDS;
				const minutes = Math.floor(seconds / 60);
				const secs = Math.floor(seconds % 60);
				const label = `${minutes}:${secs.toString().padStart(2, "0")}`;

				return (
					<div key={index}>
						<div
							className="absolute bottom-0 w-px bg-muted-foreground/50"
							style={{ left: tickX, height: 12 }}
						/>
						<span
							className="absolute font-mono text-[0.5625rem] text-muted-foreground/70"
							style={{ left: tickX + 3, bottom: 16 }}
						>
							{label}
						</span>
					</div>
				);
			})}
		</div>
	);
}

function FrequencyAxis({ height }: { height: number }) {
	const majorCount = FREQ_LABELS.length;
	const minorPerMajor = 3;

	return (
		<div className="relative flex-shrink-0" style={{ width: FREQ_AXIS_WIDTH, height }}>
			<div className="absolute right-0 top-0 bottom-0 w-px bg-border/50" />
			{Array.from({ length: majorCount }, (_, tickIndex) => {
				const yFrac = tickIndex / (majorCount - 1);
				const yPos = yFrac * (height - 2) + 1;
				return (
					<div key={`major-${tickIndex}`}>
						<div
							className="absolute right-0 h-px bg-muted-foreground/50"
							style={{ top: yPos, width: 8 }}
						/>
						<span
							className="absolute right-[10px] font-mono text-[8px] text-muted-foreground/60 text-right"
							style={{ top: yPos - 4 }}
						>
							{FREQ_LABELS[tickIndex]}
						</span>
					</div>
				);
			})}
			{Array.from({ length: (majorCount - 1) * minorPerMajor }, (_, tickIndex) => {
				const majorIndex = Math.floor(tickIndex / minorPerMajor);
				const sub = (tickIndex % minorPerMajor) + 1;
				if (sub === minorPerMajor) return null;
				const frac = (majorIndex + sub / minorPerMajor) / (majorCount - 1);
				const yPos = frac * (height - 2) + 1;
				return (
					<div
						key={`minor-${tickIndex}`}
						className="absolute right-0 h-px bg-muted-foreground/20"
						style={{ top: yPos, width: 4 }}
					/>
				);
			})}
		</div>
	);
}

function AmplitudeAxis({ height }: { height: number }) {
	const majorCount = AMP_LABELS.length;
	const minorPerMajor = 3;

	return (
		<div className="relative flex-shrink-0" style={{ width: AMP_AXIS_WIDTH, height }}>
			<div className="absolute left-0 top-0 bottom-0 w-px bg-border/50" />
			{Array.from({ length: majorCount }, (_, tickIndex) => {
				const yPos = (tickIndex / (majorCount - 1)) * (height - 2) + 1;
				return (
					<div key={`major-${tickIndex}`}>
						<div
							className="absolute left-0 h-px bg-muted-foreground/50"
							style={{ top: yPos, width: 8 }}
						/>
						<span
							className="absolute left-[10px] font-mono text-[8px] text-muted-foreground/60"
							style={{ top: yPos - 4 }}
						>
							{AMP_LABELS[tickIndex]}
						</span>
					</div>
				);
			})}
			{Array.from({ length: (majorCount - 1) * minorPerMajor }, (_, tickIndex) => {
				const majorIndex = Math.floor(tickIndex / minorPerMajor);
				const sub = (tickIndex % minorPerMajor) + 1;
				if (sub === minorPerMajor) return null;
				const frac = (majorIndex + sub / minorPerMajor) / (majorCount - 1);
				const yPos = frac * (height - 2) + 1;
				return (
					<div
						key={`minor-${tickIndex}`}
						className="absolute left-0 h-px bg-muted-foreground/20"
						style={{ top: yPos, width: 4 }}
					/>
				);
			})}
		</div>
	);
}

function ChannelLane({ channelLabel, waveformData, spectrogramData, colormap, waveColor }: { channelLabel: string; waveformData: Float32Array; spectrogramData: Float32Array; colormap: ColormapFn; waveColor: string }) {
	return (
		<div className="relative">
			<span className="absolute left-1 top-1 z-10 font-mono text-[0.5625rem] text-muted-foreground/50">{channelLabel}</span>
			<div
				className="relative overflow-hidden"
				style={{ width: LANE_WIDTH, height: LANE_HEIGHT }}
			>
				<div className="absolute inset-0">
					<SpectrogramCanvas
						data={spectrogramData}
						numFrames={NUM_FRAMES}
						numBins={NUM_BINS}
						width={LANE_WIDTH}
						height={LANE_HEIGHT}
						dbRange={DB_RANGE}
						colormap={colormap}
					/>
				</div>
				<div className="absolute inset-0">
					<WaveformCanvas
						data={waveformData}
						width={LANE_WIDTH}
						height={LANE_HEIGHT}
						color={waveColor}
						opacity={0.7}
					/>
				</div>
			</div>
		</div>
	);
}

function PlayheadOverlay({ height }: { height: number }) {
	const left = PLAYHEAD_POSITION * LANE_WIDTH;

	return (
		<div
			className="pointer-events-none absolute top-0 z-20"
			style={{ left: FREQ_AXIS_WIDTH + left, height }}
		>
			<div className="relative">
				<div
					className="absolute top-0 w-px bg-playhead"
					style={{ height }}
				/>
				<div className="absolute -left-[4px] top-0 h-0 w-0 border-l-[5px] border-r-[5px] border-t-[6px] border-l-transparent border-r-transparent border-t-playhead" />
			</div>
		</div>
	);
}

function SelectionOverlay() {
	const selectionStart = 0.25;
	const selectionEnd = 0.45;
	const left = selectionStart * LANE_WIDTH + FREQ_AXIS_WIDTH;
	const selectionWidth = (selectionEnd - selectionStart) * LANE_WIDTH;

	return (
		<div
			className="pointer-events-none absolute z-10 bg-[var(--color-status-processing)]/20 border-x border-[var(--color-status-processing)]/40"
			style={{
				left,
				top: RULER_HEIGHT,
				width: selectionWidth,
				height: LANE_HEIGHT,
			}}
		/>
	);
}

export function Workspace() {
	const [activeColormap, setActiveColormap] = useState("lava");
	const activeMap = COLORMAPS.find((cm) => cm.id === activeColormap) ?? DEFAULT_COLORMAP;
	const colormapFn = activeMap.colorFn;
	const waveColor = activeMap.waveColor;

	const waveformData = useMemo(() => generateStereoWaveformData(DURATION_SECONDS, POINTS_PER_SECOND), []);
	const spectrogramData = useMemo(() => generateStereoSpectrogramData(NUM_FRAMES, NUM_BINS), []);

	const totalHeight = RULER_HEIGHT + LANE_HEIGHT * 2 + 1;
	const contentWidth = FREQ_AXIS_WIDTH + LANE_WIDTH + AMP_AXIS_WIDTH;
	const cardPadding = 24 + 2; // p-3 (12px * 2) + border (1px * 2)
	const totalWidth = contentWidth + cardPadding;

	return (
		<div className="space-y-6" style={{ maxWidth: totalWidth }}>
			<div>
				<div className="mb-3 flex items-center justify-between">
					<h4 className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">Audio Workspace — 2-Channel Demo</h4>
					<div className="flex gap-1">
						{COLORMAPS.map((cm) => (
							<button
								key={cm.id}
								onClick={() => setActiveColormap(cm.id)}
								className={`px-2.5 py-1 font-mono text-[0.625rem] transition-colors ${
									activeColormap === cm.id ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
								}`}
							>
								{cm.label}
							</button>
						))}
					</div>
				</div>
				<div className="border border-border bg-card p-3">
					<div
						className="relative flex"
						style={{ width: contentWidth }}
					>
						<div className="flex flex-col">
							<div style={{ height: RULER_HEIGHT }} />
							<FrequencyAxis height={LANE_HEIGHT * 2 + 1} />
						</div>

						<div className="relative shrink-0" style={{ width: LANE_WIDTH }}>
							<TimeRuler width={LANE_WIDTH} />
							<ChannelLane
								channelLabel="L"
								waveformData={waveformData.left}
								spectrogramData={spectrogramData.left}
								colormap={colormapFn}
								waveColor={waveColor}
							/>
							<div className="h-px bg-border/30" />
							<ChannelLane
								channelLabel="R"
								waveformData={waveformData.right}
								spectrogramData={spectrogramData.right}
								colormap={colormapFn}
								waveColor={waveColor}
							/>
							<PlayheadOverlay height={totalHeight} />
							<SelectionOverlay />
						</div>

						<div className="flex flex-col">
							<div style={{ height: RULER_HEIGHT }} />
							<AmplitudeAxis height={LANE_HEIGHT * 2 + 1} />
						</div>
					</div>
				</div>
			</div>

			<InstrumentPanel>
				<InstrumentReadout
					label="Duration"
					value={`${DURATION_SECONDS}.0`}
					unit="seconds"
				/>
				<InstrumentReadout
					label="Channels"
					value="2"
					unit="stereo"
				/>
				<InstrumentReadout
					label="Resolution"
					value={`${NUM_FRAMES} / ${NUM_BINS}`}
					unit="frm / bin"
				/>
			</InstrumentPanel>

			<div className="space-y-2">
				<h4 className="font-mono text-[0.625rem] uppercase tracking-[0.2em] text-muted-foreground">Visual Elements</h4>
				<div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
					<div className="flex items-center gap-2">
						<div className="h-3 w-3" style={{ backgroundColor: waveColor }} />
						<span>Waveform signal</span>
					</div>
					<div className="flex items-center gap-2">
						<div
							className="h-3 w-6"
							style={{ background: "linear-gradient(90deg, #000, #440154, #31688e, #35b779, #a8bf2f)" }}
						/>
						<span>Viridis</span>
					</div>
					<div className="flex items-center gap-2">
						<div
							className="h-3 w-6"
							style={{ background: "linear-gradient(90deg, #000, #a01400, #dc5014, #fcb03c, #fff)" }}
						/>
						<span>Lava</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="h-3 w-px bg-playhead" />
						<span>Playhead</span>
					</div>
					<div className="flex items-center gap-2">
						<div className="h-3 w-6 bg-[var(--color-status-processing)]/20 border border-[var(--color-status-processing)]/40" />
						<span>Selection</span>
					</div>
				</div>
			</div>
		</div>
	);
}
