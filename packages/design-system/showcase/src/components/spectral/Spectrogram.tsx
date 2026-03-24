import { useRef, useEffect, useCallback } from "react";
import type { DemoAudioData } from "../../data/demoAudio";

interface ColormapStop {
  readonly pos: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

// Lava colormap — 12 evenly-spaced control points
const LAVA_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [5, 5, 30], [15, 20, 70], [30, 15, 50],
  [80, 10, 5], [140, 20, 0], [185, 55, 0], [215, 100, 5],
  [240, 155, 25], [252, 210, 70], [255, 240, 140], [255, 255, 255],
];

const LAVA_COLORMAP: ReadonlyArray<ColormapStop> = LAVA_POINTS.map((rgb, index) => ({
  pos: index / (LAVA_POINTS.length - 1),
  r: rgb[0],
  g: rgb[1],
  b: rgb[2],
}));

function interpolateLava(value: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, value));
  const first = LAVA_COLORMAP[0];
  const last = LAVA_COLORMAP[LAVA_COLORMAP.length - 1];

  if (!first || !last) return [0, 0, 0];

  let lo = first;
  let hi = last;

  for (let si = 0; si < LAVA_COLORMAP.length - 1; si++) {
    const lower = LAVA_COLORMAP[si];
    const upper = LAVA_COLORMAP[si + 1];

    if (!lower || !upper) continue;

    if (clamped >= lower.pos && clamped <= upper.pos) {
      lo = lower;
      hi = upper;
      break;
    }
  }

  const range = hi.pos - lo.pos;
  const factor = range > 0 ? (clamped - lo.pos) / range : 0;

  return [
    Math.round(lo.r + (hi.r - lo.r) * factor),
    Math.round(lo.g + (hi.g - lo.g) * factor),
    Math.round(lo.b + (hi.b - lo.b) * factor),
  ];
}

interface SpectrogramProps {
  readonly data: DemoAudioData;
  readonly startMs: number;
  readonly endMs: number;
}

export function Spectrogram({ data, startMs, endMs }: SpectrogramProps) {
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

    const imageData = gfx.createImageData(width, height);
    const pixels = imageData.data;

    const durationMs = data.duration * 1000;
    const startFrac = startMs / durationMs;
    const endFrac = endMs / durationMs;

    for (let px = 0; px < width; px++) {
      const timeFrac = startFrac + (px / width) * (endFrac - startFrac);
      const frameIndex = Math.floor(timeFrac * data.timeFrames);
      const clampedFrame = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
      const frame = data.spectrogram[clampedFrame];

      if (!frame) continue;

      for (let py = 0; py < height; py++) {
        const freqFrac = 1 - py / height;
        const binIndex = Math.floor(freqFrac * data.freqBins);
        const clampedBin = Math.max(0, Math.min(data.freqBins - 1, binIndex));
        const value = frame[clampedBin] ?? 0;

        const rgb = interpolateLava(value);
        const pixelOffset = (py * width + px) * 4;

        pixels[pixelOffset] = rgb[0];
        pixels[pixelOffset + 1] = rgb[1];
        pixels[pixelOffset + 2] = rgb[2];
        pixels[pixelOffset + 3] = 255;
      }
    }

    gfx.putImageData(imageData, 0, 0);
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
