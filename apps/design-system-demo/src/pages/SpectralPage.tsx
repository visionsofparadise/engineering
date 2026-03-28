import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpectrogramCanvas, WaveformCanvas, LoudnessCanvas, useSpectralCompute } from "@e9g/spectral-display";
import type { SpectralOptions, ColormapDefinition } from "@e9g/spectral-display";
import {
  Knob,
  Selection,
  FrequencyAxis,
  DbAxis,
  TimeRuler,
  Transport,
  StereoMeter,
  FrequencyMinimap,
  AppTabBar,
  IconButton,
  getThemeColors,
} from "@e9g/design-system";
import type { AudioData, MenuItem } from "@e9g/design-system";
import { loadAudio } from "../data/audioLoader";
import { useColormapTheme } from "../ThemeContext";

const SPECTRAL_TABS = [
  { id: "podcast", label: "podcast-raw.wav" },
  { id: "interview", label: "interview-backup.wav" },
] as const;

const MENU_ITEMS: ReadonlyArray<MenuItem> = [
  { kind: "action", icon: "lucide:file-plus", label: "New Session", shortcut: "Ctrl+N" },
  { kind: "action", icon: "lucide:folder-open", label: "Open Session", shortcut: "Ctrl+O" },
  { kind: "action", icon: "lucide:save", label: "Save", shortcut: "Ctrl+S" },
  { kind: "action", icon: "lucide:save-all", label: "Save As\u2026", shortcut: "Ctrl+Shift+S" },
  { kind: "separator" },
  { kind: "action", icon: "lucide:app-window", label: "New Window", shortcut: "Ctrl+Shift+N" },
  { kind: "action", icon: "lucide:x", label: "Close Window", shortcut: "Ctrl+W" },
  { kind: "separator" },
  { kind: "action", icon: "lucide:undo-2", label: "Undo", shortcut: "Ctrl+Z" },
  { kind: "action", icon: "lucide:redo-2", label: "Redo", shortcut: "Ctrl+Shift+Z" },
  { kind: "separator" },
  { kind: "action", icon: "lucide:settings", label: "Settings", shortcut: "Ctrl+," },
];

// Static view window — visual demo, not functional
const VIEW_START_FRAC = 0.30;
const VIEW_END_FRAC = 0.50;
const SELECTION_START = 0.25;
const SELECTION_END = 0.45;
const CURSOR_FRAC = 0.38;


function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 800, height: 400 });

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) return;

      setSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height),
      });
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return size;
}

interface CursorReadout {
  time: string;
  freq: string;
  amp: string;
}

type GridMode = "freq" | "amp";

function MiniDropdown({ value, options, labels, onChange }: {
  readonly value: string;
  readonly options: ReadonlyArray<string>;
  readonly labels?: ReadonlyArray<string>;
  readonly onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const displayLabel = labels ? labels[options.indexOf(value)] ?? value : value;

  return (
    <div className="relative">
      <button
        type="button"
        className="flex items-center gap-0.5 px-1 py-0.5 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text hover:text-chrome-text"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-0.5 bg-chrome-raised">
          <span>{displayLabel}</span>
          <Icon icon="lucide:chevron-down" width={10} height={10} />
        </span>
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 flex flex-col py-1 bg-chrome-raised">
          {options.map((opt, index) => (
            <button
              key={opt}
              type="button"
              className={`whitespace-nowrap px-3 py-1 text-left font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] hover:bg-interactive-hover ${opt === value ? "text-chrome-text" : "text-chrome-text-secondary"}`}
              onClick={() => { onChange(opt); setOpen(false); }}
            >
              {labels ? labels[index] : opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GridOverlay({ startMs, endMs, mode, opacity }: { startMs: number; endMs: number; mode: GridMode; opacity: number }) {
  const spanMs = endMs - startMs;

  // Time grid — match ruler major ticks
  let majorMs = 5000;

  if (spanMs < 2000) majorMs = 200;
  else if (spanMs < 5000) majorMs = 500;
  else if (spanMs < 10000) majorMs = 1000;
  else if (spanMs < 30000) majorMs = 2000;
  else if (spanMs < 60000) majorMs = 5000;
  else majorMs = 10000;

  const timeTicks: Array<number> = [];
  const first = Math.ceil(startMs / majorMs) * majorMs;

  for (let tick = first; tick <= endMs; tick += majorMs) {
    timeTicks.push((tick - startMs) / spanMs);
  }

  // Horizontal grid
  const hLines: Array<number> = [];

  if (mode === "freq") {
    // Frequency lines — mel scale positions matching FrequencyAxis
    const FREQ_MIN = 20;
    const FREQ_MAX = 22050;
    const melMin = 2595 * Math.log10(1 + FREQ_MIN / 700);
    const melMax = 2595 * Math.log10(1 + FREQ_MAX / 700);

    for (const hz of [100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      const mel = 2595 * Math.log10(1 + hz / 700);

      hLines.push(1 - (mel - melMin) / (melMax - melMin));
    }
  } else {
    // Amplitude lines — dB positions matching DbAxis (symmetric)
    const dbToLinear = (db: number) => Math.pow(10, db / 20);

    for (const db of [-3, -6, -12, -24]) {
      const amp = dbToLinear(db);

      hLines.push((1 - amp) * 0.5); // top half
      hLines.push(0.5 + amp * 0.5); // bottom half (mirror)
    }

    hLines.push(0.5); // center line
  }

  return (
    <div className="pointer-events-none absolute inset-0" style={{ opacity }}>
      {timeTicks.map((frac) => (
        <div
          key={`t${frac}`}
          className="absolute top-0 bottom-0 w-px bg-chrome-text"
          style={{ left: `${frac * 100}%` }}
        />
      ))}
      {hLines.map((frac, index) => (
        <div
          key={`h${index}`}
          className="absolute left-0 right-0 h-px bg-chrome-text"
          style={{ top: `${frac * 100}%` }}
        />
      ))}
    </div>
  );
}

function SpectralDisplay({ audioData, startMs, endMs, gridMode, gridOpacity, fftSize, hopOverlap, colormap, waveformColor, loudnessColors, onCursorMove }: { audioData: AudioData; startMs: number; endMs: number; gridMode: GridMode; gridOpacity: number; fftSize: number; hopOverlap: number; colormap: ColormapDefinition; waveformColor: [number, number, number]; loudnessColors: { rms: string; momentary: string; shortTerm: string; integrated: string; truePeak: string }; onCursorMove?: (readout: CursorReadout) => void }) {
  const displayRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(displayRef);

  const handleMouseMove = useCallback((ev: React.MouseEvent<HTMLDivElement>) => {
    if (!onCursorMove || !displayRef.current) return;

    const rect = displayRef.current.getBoundingClientRect();
    const xFrac = (ev.clientX - rect.left) / rect.width;
    const yFrac = (ev.clientY - rect.top) / rect.height;

    const timeMs = startMs + xFrac * (endMs - startMs);
    const totalSec = timeMs / 1000;
    const mins = Math.floor(totalSec / 60);
    const secs = Math.floor(totalSec % 60);
    const ms = Math.floor((totalSec % 1) * 1000);
    const timeStr = `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(3, "0")}`;

    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const freqHz = Math.pow(10, logMax - yFrac * (logMax - logMin));
    const freqStr = freqHz >= 1000 ? `${(freqHz / 1000).toFixed(1)} kHz` : `${Math.round(freqHz)} Hz`;

    const baseAmp = -60 + (1 - yFrac) * 55 + (Math.random() - 0.5) * 6;
    const ampStr = `${baseAmp.toFixed(1)} dB`;

    onCursorMove({ time: timeStr, freq: freqStr, amp: ampStr });
  }, [onCursorMove, startMs, endMs]);

  const spectralOptions = useMemo<SpectralOptions>(
    () => ({
      metadata: {
        sampleRate: audioData.sampleRate,
        sampleCount: audioData.totalSamples,
        channelCount: audioData.channels,
      },
      query: { startMs, endMs, width, height },
      readSamples: audioData.readSamples,
      config: {
        fftSize,
        hopOverlap,
        frequencyScale: "mel",
        colormap,
        loudness: true,
        truePeak: true,
      },
    }),
    [audioData, startMs, endMs, width, height, fftSize, hopOverlap, colormap],
  );

  const computeResult = useSpectralCompute(spectralOptions);

  return (
    <div ref={displayRef} className="relative overflow-hidden bg-void" onMouseMove={handleMouseMove}>
      {computeResult.status === "ready" && (
        <>
          <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
            <SpectrogramCanvas computeResult={computeResult} />
          </div>
          <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
            <WaveformCanvas computeResult={computeResult} color={waveformColor} />
          </div>
          <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
            <LoudnessCanvas
              computeResult={computeResult}
              rmsEnvelope
              integrated
              truePeak
              colors={loudnessColors}
            />
          </div>
        </>
      )}
      <GridOverlay startMs={startMs} endMs={endMs} mode={gridMode} opacity={gridOpacity} />
      <Selection startFraction={SELECTION_START} endFraction={SELECTION_END} />
      <div
        className="absolute top-0 bottom-0 w-px bg-data-cursor"
        style={{ left: `${CURSOR_FRAC * 100}%` }}
      />
    </div>
  );
}

function MinimapDisplay({ audioData, waveformColor }: { audioData: AudioData; waveformColor: [number, number, number] }) {
  const minimapRef = useRef<HTMLDivElement>(null);
  const { width, height } = useContainerSize(minimapRef);

  const spectralOptions = useMemo<SpectralOptions>(
    () => ({
      metadata: {
        sampleRate: audioData.sampleRate,
        sampleCount: audioData.totalSamples,
        channelCount: audioData.channels,
      },
      query: { startMs: 0, endMs: audioData.durationMs, width, height },
      readSamples: audioData.readSamples,
      config: {
        spectrogram: false,
        loudness: false,
      },
    }),
    [audioData, width, height],
  );

  const computeResult = useSpectralCompute(spectralOptions);

  const vpStartPct = VIEW_START_FRAC * 100;
  const vpWidthPct = (VIEW_END_FRAC - VIEW_START_FRAC) * 100;

  return (
    <div ref={minimapRef} className="relative h-10 bg-void">
      {computeResult.status === "ready" && (
        <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
          <WaveformCanvas computeResult={computeResult} color={waveformColor} />
        </div>
      )}
      <div
        className="absolute inset-y-0 left-0 bg-black/55"
        style={{ width: `${vpStartPct}%` }}
      />
      <div
        className="absolute inset-y-0 right-0 bg-black/55"
        style={{ width: `${(1 - VIEW_END_FRAC) * 100}%` }}
      />
      <div
        className="absolute inset-y-0 border border-data-selection-border"
        style={{ left: `${vpStartPct}%`, width: `${vpWidthPct}%` }}
      />
    </div>
  );
}

const DEFAULT_CURSOR: CursorReadout = { time: "00:01:32.450", freq: "440 Hz", amp: "-24.5 dB" };

export function SpectralPage() {
  const { colormap } = useColormapTheme();
  const themeColors = getThemeColors(colormap);
  const [audioData, setAudioData] = useState<AudioData | null>(null);
  const [cursorReadout, setCursorReadout] = useState<CursorReadout>(DEFAULT_CURSOR);
  const [gridMode, setGridMode] = useState<GridMode>("freq");
  const [gridOpacity, setGridOpacity] = useState(0.3);
  const [fftSize, setFftSize] = useState(2048);
  const [hopOverlap, setHopOverlap] = useState(16);

  useEffect(() => {
    let cancelled = false;

    void loadAudio("/test-voice.wav").then((data) => {
      if (cancelled) return;

      setAudioData(data);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!audioData) {
    return (
      <div className="flex h-full items-center justify-center bg-void">
        <span className="font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text-dim">
          Loading audio...
        </span>
      </div>
    );
  }

  const startMs = audioData.durationMs * VIEW_START_FRAC;
  const endMs = audioData.durationMs * VIEW_END_FRAC;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-void">
      <AppTabBar tabs={SPECTRAL_TABS} activeTabId="podcast" menuItems={MENU_ITEMS} />
      {/* Top bar — columns match grid below */}
      <div className="relative flex h-8 items-center bg-void px-4">
        {/* Left: Source → Current + Reference + A/B */}
        <div className="z-10 hidden items-center gap-2 wide:flex">
          <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">Source</span>
          <span className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
            interview_raw.wav
          </span>
          <Icon icon="lucide:arrow-right" width={12} height={12} className="shrink-0 text-chrome-text-dim" />
          <Icon icon="lucide:file-audio" width={14} height={14} className="shrink-0 text-chrome-text-dim" />
          <span className="truncate font-body text-[length:var(--text-sm)] text-chrome-text">
            test-voice.wav
          </span>
          <IconButton icon="lucide:folder-open" label="Open folder" size={12} className="shrink-0" />
          <div className="h-4 w-px bg-chrome-border-subtle" />
          <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">Ref</span>
          <span className="font-body text-[length:var(--text-sm)] text-chrome-text-dim">{"\u2014"}</span>
          <IconButton icon="lucide:file-plus" label="Load reference file" size={12} className="shrink-0" />
          <div className="flex items-center gap-1">
            <Knob value={0.5} label="" size={18} hideValue />
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">A/B</span>
          </div>
        </div>

        {/* Center: Node navigation — absolutely centered */}
        <div className="absolute inset-0 flex items-center justify-center gap-4">
          <button
            type="button"
            className="flex items-center gap-0.5 px-2 py-1 font-body text-[length:var(--text-sm)] text-chrome-text hover:text-chrome-text"
          >
            <span className="flex items-center gap-0.5 bg-chrome-raised">
              <Icon icon="lucide:chevron-left" width={14} height={14} />
              <span>Voice Denoise</span>
              <Icon icon="lucide:chevron-down" width={12} height={12} />
            </span>
          </button>
          <div className="flex items-center gap-1">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">A/B</span>
            <Knob value={0} label="" size={18} hideValue />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-body text-[length:var(--text-base)] font-medium text-chrome-text">
              De-Click
            </span>
            <button
              type="button"
              className="flex items-center justify-center py-1 text-chrome-text-secondary hover:text-chrome-text"
              aria-label="Re-render"
            >
              <Icon icon="lucide:refresh-cw" width={14} height={14} />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <Knob value={0} label="" size={18} hideValue />
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">A/B</span>
          </div>
          <button
            type="button"
            className="flex items-center gap-0.5 px-2 py-1 font-body text-[length:var(--text-sm)] text-chrome-text hover:text-chrome-text"
          >
            <span className="flex items-center gap-0.5 bg-chrome-raised">
              <Icon icon="lucide:chevron-down" width={12} height={12} />
              <span>Normalize</span>
              <Icon icon="lucide:chevron-right" width={14} height={14} />
            </span>
          </button>
        </div>

        {/* Right: Undo/redo + history + close */}
        <div className="z-10 ml-auto flex items-center gap-3">
          <div className="hidden items-center wide:flex">
            <IconButton icon="lucide:undo-2" label="Undo" size={16} />
            <IconButton icon="lucide:redo-2" label="Redo" size={16} dim />
          </div>
          <button
            type="button"
            className="flex h-7 items-center gap-1 px-2 py-1 font-body text-[length:var(--text-sm)] text-chrome-text hover:text-chrome-text"
          >
            <span className="flex items-center gap-1 bg-chrome-raised">
              <Icon icon="lucide:history" width={14} height={14} />
              <span>Snapshot 3</span>
              <Icon icon="lucide:chevron-down" width={12} height={12} />
            </span>
          </button>
          <div className="h-4 w-px bg-chrome-border-subtle" />
          <button
            type="button"
            className="flex h-7 items-center gap-1 px-2 py-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text hover:text-chrome-text"
          >
            <span className="flex items-center gap-1 bg-secondary">
              <Icon icon="lucide:download" width={14} height={14} />
              <span>Export</span>
            </span>
          </button>
          <IconButton icon="lucide:x" label="Back to graph" />
        </div>
      </div>

      {/* Main content: grid + right column */}
      <div className="flex min-h-0 flex-1">
        {/* Grid */}
        <div
          className="min-h-0 min-w-0 flex-1 overflow-hidden"
          style={{
            display: "grid",
            gridTemplateColumns: "2.5rem minmax(0, 1fr) auto auto",
            gridTemplateRows: "2rem minmax(0, 1fr) auto",
          }}
        >
          {/* Row 1: blank | ruler | blank | blank */}
          <div className="bg-void" />
          <TimeRuler startMs={startMs} endMs={endMs} />
          <div className="bg-void" />
          <div className="bg-void" />

          {/* Row 2: freq axis | display | freq minimap | dB axis */}
          <FrequencyAxis />
          <SpectralDisplay audioData={audioData} startMs={startMs} endMs={endMs} gridMode={gridMode} gridOpacity={gridOpacity} fftSize={fftSize} hopOverlap={hopOverlap} colormap={themeColors.colormap} waveformColor={themeColors.waveform} loudnessColors={themeColors.loudness} onCursorMove={setCursorReadout} />
          <FrequencyMinimap audioData={audioData} startMs={startMs} endMs={endMs} colormap={colormap} />
          <DbAxis />

          {/* Row 3: blank | minimap | blank | blank */}
          <div className="bg-void" />
          <MinimapDisplay audioData={audioData} waveformColor={themeColors.waveform} />
          <div className="bg-void" />
          <div className="bg-void" />
        </div>

        {/* Right column */}
        <div className="flex w-16 shrink-0 flex-col items-center bg-void">
          {/* Top spacer — matches ruler row, meter readouts */}
          <div className="flex h-8 shrink-0 items-end justify-center gap-1.5 pb-1.5 font-technical tabular-nums text-[8px] text-chrome-text-secondary">
            <span>-3.2</span>
            <span>-4.1</span>
          </div>
          {/* Upper half — stereo meters */}
          <div className="flex-1 self-stretch">
            <StereoMeter colormap={colormap} />
          </div>
          {/* Lower half — display controls */}
          <div className="flex flex-1 flex-col items-center justify-center gap-2">
            {/* Grid opacity knob + toggle */}
            <div className="flex flex-col items-center gap-0.5">
              <Knob value={gridOpacity} label="" size={24} hideValue onChange={setGridOpacity} />
              <Icon icon="lucide:grid-3x3" width={12} height={12} className="text-chrome-text-dim" />
            </div>
            <div className="flex flex-col items-center">
              <IconButton icon="lucide:music" label="Frequency grid" size={12} variant="ghost" active={gridMode === "freq"} onClick={() => setGridMode("freq")} />
              <IconButton icon="lucide:gauge" label="Amplitude grid" size={12} variant="ghost" active={gridMode === "amp"} onClick={() => setGridMode("amp")} />
            </div>
            {/* Separator */}
            <div className="my-3 w-6 border-t border-chrome-border-subtle" />
            {/* Waveform knob */}
            <div className="flex flex-col items-center gap-0.5">
              <Knob value={0.8} label="" size={24} hideValue />
              <Icon icon="lucide:audio-waveform" width={12} height={12} className="text-chrome-text-dim" />
            </div>
            {/* Separator */}
            <div className="my-3 w-6 border-t border-chrome-border-subtle" />
            {/* Spectrogram knob */}
            <div className="flex flex-col items-center gap-0.5">
              <Knob value={0.7} label="" size={24} hideValue />
              <Icon icon="lucide:flame" width={12} height={12} className="text-chrome-text-dim" />
            </div>
            {/* Frequency scale dropdown */}
            <button
              type="button"
              className="flex items-center gap-0.5 px-1 py-0.5 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text hover:text-chrome-text"
            >
              <span className="flex items-center gap-0.5 bg-chrome-raised">
                <span>Mel</span>
                <Icon icon="lucide:chevron-down" width={10} height={10} />
              </span>
            </button>
            {/* FFT size */}
            <div className="block">
              <MiniDropdown
                value={String(fftSize)}
                options={["1024", "2048", "4096", "8192", "16384"]}
                onChange={(value) => setFftSize(Number(value))}
              />
            </div>
            {/* Hop overlap */}
            <div className="block">
              <MiniDropdown
                value={String(hopOverlap)}
                options={["2", "4", "8", "16", "32"]}
                labels={["1/2", "1/4", "1/8", "1/16", "1/32"]}
                onChange={(value) => setHopOverlap(Number(value))}
              />
            </div>
            {/* Separator */}
            <div className="my-1 w-6 border-t border-chrome-border-subtle" />
            {/* Loudness knob */}
            <div className="flex flex-col items-center gap-0.5">
              <Knob value={0.5} label="" size={24} hideValue />
              <Icon icon="lucide:activity" width={12} height={12} className="text-chrome-text-dim" />
            </div>
          </div>
          {/* Bottom spacer — matches minimap row */}
          <div className="h-10 shrink-0" />
        </div>
      </div>

      {/* Transport bar */}
      <Transport cursorTime={cursorReadout.time} cursorFreq={cursorReadout.freq} cursorAmp={cursorReadout.amp} />
    </div>
  );
}
