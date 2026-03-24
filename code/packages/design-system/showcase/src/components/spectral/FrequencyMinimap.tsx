import { useRef, useState, useEffect, useMemo } from "react";
import { SpectrogramCanvas, useSpectralCompute } from "spectral-display";
import type { SpectralOptions } from "spectral-display";
import type { AudioData } from "../../data/audioLoader";

const STRIP_WIDTH = 14;

// Static vertical viewport — full range (no vertical zoom applied)
const VP_TOP_FRAC = 0;
const VP_BOTTOM_FRAC = 1;

interface FrequencyMinimapProps {
  readonly audioData: AudioData;
  readonly startMs: number;
  readonly endMs: number;
}

export function FrequencyMinimap({ audioData, startMs, endMs }: FrequencyMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) return;

      const dpr = window.devicePixelRatio || 1;

      setContainerHeight(Math.round(entry.contentRect.height * dpr));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const spectralOptions = useMemo<SpectralOptions>(
    () => ({
      metadata: {
        sampleRate: audioData.sampleRate,
        sampleCount: audioData.totalSamples,
        channelCount: audioData.channels,
      },
      query: { startMs, endMs, width: 1, height: containerHeight },
      readSamples: audioData.readSamples,
      config: {
        fftSize: 2048,
        frequencyScale: "mel",
        colormap: "lava",
        waveform: false,
        loudness: false,
      },
    }),
    [audioData, startMs, endMs, containerHeight],
  );

  const computeResult = useSpectralCompute(spectralOptions);

  const vpTopPct = VP_TOP_FRAC * 100;
  const vpHeightPct = (VP_BOTTOM_FRAC - VP_TOP_FRAC) * 100;

  return (
    <div
      ref={containerRef}
      className="relative bg-void"
      style={{ width: STRIP_WIDTH }}
    >
      {computeResult.status === "ready" && (
        <div className="absolute inset-0 [&>canvas]:h-full [&>canvas]:w-full">
          <SpectrogramCanvas computeResult={computeResult} />
        </div>
      )}
      {/* Dimmed regions outside viewport */}
      <div
        className="absolute inset-x-0 top-0 bg-black/55"
        style={{ height: `${vpTopPct}%` }}
      />
      <div
        className="absolute inset-x-0 bottom-0 bg-black/55"
        style={{ height: `${(1 - VP_BOTTOM_FRAC) * 100}%` }}
      />
      {/* Viewport bracket */}
      <div
        className="absolute inset-x-0 border border-data-selection-border"
        style={{ top: `${vpTopPct}%`, height: `${vpHeightPct}%` }}
      />
    </div>
  );
}
