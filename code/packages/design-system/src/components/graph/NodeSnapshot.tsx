import { useEffect, useMemo, useRef, useState } from "react";
import { SpectrogramCanvas, WaveformCanvas, useSpectralCompute } from "spectral-display";
import type { SpectralOptions } from "spectral-display";
import type { ColormapTheme } from "../../colors";
import { getThemeColors } from "../../colors";
import type { AudioData } from "../spectral/types";

export interface NodeSnapshotProps {
  readonly audioData: AudioData | null;
  readonly colormap?: ColormapTheme;
}

export function NodeSnapshot({ audioData, colormap = "lava" }: NodeSnapshotProps) {
  if (!audioData) return null;

  return <SnapshotInner audioData={audioData} colormap={colormap} />;
}

function SnapshotInner({ audioData, colormap = "lava" }: { readonly audioData: AudioData; readonly colormap?: ColormapTheme }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 260, height: 48 });
  const themeColors = getThemeColors(colormap);

  useEffect(() => {
    const element = containerRef.current;

    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];

      if (!entry) return;
      const { width, height } = entry.contentRect;

      if (width > 0 && height > 0) {
        setSize({ width: Math.round(width), height: Math.round(height) });
      }
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
      query: { startMs: 0, endMs: audioData.durationMs, width: size.width, height: size.height },
      readSamples: audioData.readSamples,
      config: {
        colormap: themeColors.colormap,
        frequencyScale: "mel",
        loudness: false,
      },
    }),
    [audioData, size.width, size.height, colormap],
  );

  const computeResult = useSpectralCompute(spectralOptions);

  return (
    <div ref={containerRef} className="relative w-full overflow-hidden bg-void" style={{ height: 48 }}>
      {computeResult.status === "ready" && (
        <>
          <div className="absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full">
            <SpectrogramCanvas computeResult={computeResult} />
          </div>
          <div className="absolute inset-0 [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full">
            <WaveformCanvas computeResult={computeResult} color={themeColors.waveform} />
          </div>
        </>
      )}
      {computeResult.status === "error" && (
        <div className="flex h-full items-center justify-center">
          <span className="font-technical text-[length:var(--text-xs)] text-state-error">
            {computeResult.error.message}
          </span>
        </div>
      )}
    </div>
  );
}
