import { Icon } from "@iconify/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpectrogramCanvas, WaveformCanvas, LoudnessCanvas, useSpectralCompute } from "spectral-display";
import type { SpectralOptions } from "spectral-display";
import { loadAudio, type AudioData } from "../data/audioLoader";
import { Knob } from "../components/controls/Knob";
import { Selection } from "../components/spectral/Selection";
import { FrequencyAxis, DbAxis, TimeRuler } from "../components/spectral/Axes";
import { Transport } from "../components/spectral/Transport";
import { StereoMeter } from "../components/spectral/StereoMeter";
import { FrequencyMinimap } from "../components/spectral/FrequencyMinimap";

// Static view window — visual demo, not functional
const VIEW_START_FRAC = 0.30;
const VIEW_END_FRAC = 0.50;
const SELECTION_START = 0.25;
const SELECTION_END = 0.45;
const CURSOR_FRAC = 0.38;

// Lava overlay colors
// Waveform: medium teal #5EC4B6 — hierarchy level 1
// RMS: deep teal #1A7A6C — hierarchy level 2
// LUFS: emerald #34D399 — hierarchy level 3
// True Peak: rose #FB7185 — hierarchy level 3
const WAVEFORM_COLOR: [number, number, number] = [94, 196, 182]; // #5EC4B6
const LOUDNESS_COLORS = {
  rms: "rgb(26, 122, 108)",            // #1A7A6C
  momentary: "rgb(52, 211, 153)",     // #34D399
  shortTerm: "rgb(52, 211, 153)",     // #34D399
  integrated: "rgb(52, 211, 153)",    // #34D399
  truePeak: "rgb(251, 113, 133)",     // #FB7185
};

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 800, height: 400 });

  useEffect(() => {
    const element = ref.current;

    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) return;

      const dpr = window.devicePixelRatio || 1;

      setSize({
        width: Math.round(entry.contentRect.width * dpr),
        height: Math.round(entry.contentRect.height * dpr),
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

function SpectralDisplay({ audioData, startMs, endMs, onCursorMove }: { audioData: AudioData; startMs: number; endMs: number; onCursorMove?: (readout: CursorReadout) => void }) {
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
        fftSize: 4096,
        frequencyScale: "mel",
        colormap: "lava",
        loudness: true,
        truePeak: true,
      },
    }),
    [audioData, startMs, endMs, width, height],
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
            <WaveformCanvas computeResult={computeResult} color={WAVEFORM_COLOR} />
          </div>
          <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
            <LoudnessCanvas
              computeResult={computeResult}
              rmsEnvelope
              integrated
              truePeak
              colors={LOUDNESS_COLORS}
            />
          </div>
        </>
      )}
      <Selection startFraction={SELECTION_START} endFraction={SELECTION_END} />
      <div
        className="absolute top-0 bottom-0 w-px bg-data-cursor"
        style={{ left: `${CURSOR_FRAC * 100}%` }}
      />
    </div>
  );
}

function MinimapDisplay({ audioData }: { audioData: AudioData }) {
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
          <WaveformCanvas computeResult={computeResult} color={WAVEFORM_COLOR} />
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
  const [audioData, setAudioData] = useState<AudioData | null>(null);
  const [cursorReadout, setCursorReadout] = useState<CursorReadout>(DEFAULT_CURSOR);

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
      {/* Top bar — columns match grid below */}
      <div className="relative flex h-8 items-center bg-void px-4">
        {/* Left: Source → Current + Reference + A/B */}
        <div className="z-10 flex items-center gap-2">
          <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">Source</span>
          <span className="font-body text-[length:var(--text-sm)] text-chrome-text-secondary">
            interview_raw.wav
          </span>
          <Icon icon="lucide:arrow-right" width={12} height={12} className="shrink-0 text-chrome-text-dim" />
          <Icon icon="lucide:file-audio" width={14} height={14} className="shrink-0 text-chrome-text-dim" />
          <span className="truncate font-body text-[length:var(--text-sm)] text-chrome-text">
            test-voice.wav
          </span>
          <button
            type="button"
            className="flex shrink-0 items-center justify-center bg-chrome-raised mx-1 py-1 text-chrome-text-secondary hover:text-chrome-text"
            aria-label="Open folder"
          >
            <Icon icon="lucide:folder-open" width={12} height={12} />
          </button>
          <div className="h-4 w-px bg-chrome-border-subtle" />
          <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">Ref</span>
          <span className="font-body text-[length:var(--text-sm)] text-chrome-text-dim">—</span>
          <button
            type="button"
            className="flex shrink-0 items-center justify-center bg-chrome-raised mx-1 py-1 text-chrome-text-secondary hover:text-chrome-text"
            aria-label="Load reference file"
          >
            <Icon icon="lucide:file-plus" width={12} height={12} />
          </button>
          <div className="flex items-center gap-1">
            <Knob value={0.5} label="" size={18} hideValue />
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">A/B</span>
          </div>
        </div>

        {/* Center: Node navigation — absolutely centered */}
        <div className="absolute inset-0 flex items-center justify-center gap-4">
          <button
            type="button"
            className="flex items-center gap-0.5 bg-chrome-raised font-body text-[length:var(--text-sm)] text-chrome-text hover:text-chrome-text"
          >
            <Icon icon="lucide:chevron-left" width={14} height={14} />
            <span>Voice Denoise</span>
            <Icon icon="lucide:chevron-down" width={12} height={12} />
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
            className="flex items-center gap-0.5 bg-chrome-raised font-body text-[length:var(--text-sm)] text-chrome-text hover:text-chrome-text"
          >
            <Icon icon="lucide:chevron-down" width={12} height={12} />
            <span>Normalize</span>
            <Icon icon="lucide:chevron-right" width={14} height={14} />
          </button>
        </div>

        {/* Right: Undo/redo + history + close */}
        <div className="z-10 ml-auto flex items-center gap-3">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className="flex items-center justify-center mx-3 py-1 text-chrome-text-secondary hover:text-chrome-text"
              aria-label="Undo"
            >
              <Icon icon="lucide:undo-2" width={16} height={16} />
            </button>
            <button
              type="button"
              className="flex items-center justify-center mx-3 py-1 text-chrome-text-dim"
              aria-label="Redo"
            >
              <Icon icon="lucide:redo-2" width={16} height={16} />
            </button>
          </div>
          <button
            type="button"
            className="flex h-7 items-center gap-1 bg-chrome-raised font-body text-[length:var(--text-sm)] text-chrome-text hover:text-chrome-text"
          >
            <Icon icon="lucide:history" width={14} height={14} />
            <span>Snapshot 3</span>
            <Icon icon="lucide:chevron-down" width={12} height={12} />
          </button>
          <div className="h-4 w-px bg-chrome-border-subtle" />
          <button
            type="button"
            className="flex h-7 items-center gap-1 bg-secondary font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text hover:text-chrome-text"
          >
            <Icon icon="lucide:download" width={14} height={14} />
            <span>Export</span>
          </button>
          <button
            type="button"
            className="flex items-center justify-center bg-chrome-raised mx-1 py-1 text-chrome-text-secondary hover:text-chrome-text"
            aria-label="Back to graph"
          >
            <Icon icon="lucide:x" width={14} height={14} />
          </button>
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
          <SpectralDisplay audioData={audioData} startMs={startMs} endMs={endMs} onCursorMove={setCursorReadout} />
          <FrequencyMinimap audioData={audioData} startMs={startMs} endMs={endMs} />
          <DbAxis />

          {/* Row 3: blank | minimap | blank | blank */}
          <div className="bg-void" />
          <MinimapDisplay audioData={audioData} />
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
            <StereoMeter />
          </div>
          {/* Lower half — display controls */}
          <div className="flex flex-1 flex-col items-center justify-center gap-4">
            {/* Waveform knob */}
            <div className="flex flex-col items-center gap-0.5">
              <Knob value={0.8} label="" size={24} hideValue />
              <Icon icon="lucide:audio-waveform" width={12} height={12} className="text-chrome-text-dim" />
            </div>
            {/* Separator */}
            <div className="w-6 border-t border-chrome-border-subtle" />
            {/* Spectrogram knob */}
            <div className="flex flex-col items-center gap-0.5">
              <Knob value={0.7} label="" size={24} hideValue />
              <Icon icon="lucide:flame" width={12} height={12} className="text-chrome-text-dim" />
            </div>
            {/* Frequency scale dropdown */}
            <button
              type="button"
              className="flex items-center gap-0.5 bg-chrome-raised font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text hover:text-chrome-text"
            >
              <span>Mel</span>
              <Icon icon="lucide:chevron-down" width={10} height={10} />
            </button>
            {/* Separator */}
            <div className="w-6 border-t border-chrome-border-subtle" />
            {/* Loudness group — knob + checkboxes */}
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex flex-col items-center gap-0.5">
                <Knob value={0.5} label="" size={24} hideValue />
                <Icon icon="lucide:activity" width={12} height={12} className="text-chrome-text-dim" />
              </div>
              <div className="h-2" />
              <label className="flex flex-col items-center gap-0.5">
                <Icon icon="lucide:check" width={10} height={10} style={{ color: "#FB7185" }} />
                <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">True</span>
              </label>
              <label className="flex flex-col items-center gap-0.5">
                <Icon icon="lucide:check" width={10} height={10} style={{ color: "#34D399" }} />
                <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">LUFS</span>
              </label>
              <label className="flex flex-col items-center gap-0.5">
                <Icon icon="lucide:check" width={10} height={10} style={{ color: "#1A7A6C" }} />
                <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">RMS</span>
              </label>
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
