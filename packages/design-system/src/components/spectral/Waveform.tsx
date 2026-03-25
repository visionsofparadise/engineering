import { useRef, useEffect, useCallback } from "react";
import type { ColormapTheme } from "../../colors";
import { getThemeColors } from "../../colors";
import type { AudioDisplayData } from "./types";

interface WaveformProps {
  readonly data: AudioDisplayData;
  readonly startMs: number;
  readonly endMs: number;
  readonly opacity?: number;
  readonly colormap?: ColormapTheme;
}

export function Waveform({ data, startMs, endMs, opacity = 0.6, colormap = "lava" }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const waveformCss = getThemeColors(colormap).waveformCss;
  const rgbaBase = waveformCss.replace("rgb(", "").replace(")", "");

  const render = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(rect.width * dpr);
    const height = Math.round(rect.height * dpr);

    if (width === 0 || height === 0) return;

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }

    const gfx = canvas.getContext("2d");

    if (!gfx) return;

    gfx.clearRect(0, 0, width, height);

    const durationMs = data.duration * 1000;
    const startFrac = startMs / durationMs;
    const endFrac = endMs / durationMs;
    const centerY = height / 2;

    // Draw each channel
    const channelCount = data.waveform.length;

    for (let ch = 0; ch < channelCount; ch++) {
      const channelData = data.waveform[ch];

      if (!channelData) continue;

      gfx.fillStyle = ch === 0 ? `rgba(${rgbaBase}, 0.7)` : `rgba(${rgbaBase}, 0.4)`;

      for (let px = 0; px < width; px++) {
        const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
        const frameIndex = Math.floor(timeFrac * data.timeFrames);
        const clamped = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
        const frame = channelData[clamped];

        if (!frame) continue;

        const minY = centerY + frame.min * centerY * 0.8;
        const maxY = centerY - frame.max * centerY * 0.8;
        const top = Math.min(minY, maxY);
        const lineHeight = Math.max(1, Math.abs(minY - maxY));

        gfx.fillRect(px, top, 1, lineHeight);
      }
    }
  }, [data, startMs, endMs, rgbaBase]);

  useEffect(() => {
    render();

    const canvas = canvasRef.current;

    if (!canvas) return;

    const observer = new ResizeObserver(() => {
      render();
    });

    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, [render]);

  return (
    <div className="absolute inset-0" style={{ opacity }}>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
