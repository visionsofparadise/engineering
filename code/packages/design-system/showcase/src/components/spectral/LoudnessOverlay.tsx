import { useRef, useEffect, useCallback } from "react";
import type { DemoAudioData } from "../../data/demoAudio";

interface LoudnessOverlayProps {
  readonly data: DemoAudioData;
  readonly startMs: number;
  readonly endMs: number;
}

// Lava overlay colors from design tokens
const COLOR_LUFS = "#A3E635";
const COLOR_RMS = "rgba(167, 139, 250, 0.35)";
const COLOR_PEAK = "#E879F9";

export function LoudnessOverlay({ data, startMs, endMs }: LoudnessOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

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

    const dbMin = -40;
    const dbMax = 0;
    const dbRange = dbMax - dbMin;

    function dbToY(db: number): number {
      const normalized = (db - dbMin) / dbRange;

      return (1 - Math.max(0, Math.min(1, normalized))) * height;
    }

    // Draw RMS envelope
    gfx.beginPath();
    gfx.strokeStyle = COLOR_RMS;
    gfx.lineWidth = 1.5 * dpr;

    for (let px = 0; px < width; px++) {
      const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
      const frameIndex = Math.floor(timeFrac * data.timeFrames);
      const clamped = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
      const rmsDb = data.loudness.rms[clamped] ?? dbMin;
      const py = dbToY(rmsDb);

      if (px === 0) {
        gfx.moveTo(px, py);
      } else {
        gfx.lineTo(px, py);
      }
    }

    gfx.stroke();

    // Draw LUFS
    gfx.beginPath();
    gfx.strokeStyle = COLOR_LUFS;
    gfx.lineWidth = 1 * dpr;
    gfx.globalAlpha = 0.8;

    for (let px = 0; px < width; px++) {
      const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
      const frameIndex = Math.floor(timeFrac * data.timeFrames);
      const clamped = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
      const lufsDb = data.loudness.lufs[clamped] ?? dbMin;
      const py = dbToY(lufsDb);

      if (px === 0) {
        gfx.moveTo(px, py);
      } else {
        gfx.lineTo(px, py);
      }
    }

    gfx.stroke();
    gfx.globalAlpha = 1;

    // Draw Peak as dashed line at max peak
    gfx.beginPath();
    gfx.strokeStyle = COLOR_PEAK;
    gfx.lineWidth = 1 * dpr;
    gfx.setLineDash([4 * dpr, 3 * dpr]);
    gfx.globalAlpha = 0.7;

    for (let px = 0; px < width; px++) {
      const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
      const frameIndex = Math.floor(timeFrac * data.timeFrames);
      const clamped = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
      const peakDb = data.loudness.peak[clamped] ?? dbMin;
      const py = dbToY(peakDb);

      if (px === 0) {
        gfx.moveTo(px, py);
      } else {
        gfx.lineTo(px, py);
      }
    }

    gfx.stroke();
    gfx.setLineDash([]);
    gfx.globalAlpha = 1;
  }, [data, startMs, endMs]);

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
    <div className="absolute inset-0">
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
