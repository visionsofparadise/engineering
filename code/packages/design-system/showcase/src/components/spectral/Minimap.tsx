import { useRef, useEffect, useCallback } from "react";
import type { DemoAudioData } from "../../data/demoAudio";

interface MinimapProps {
  readonly data: DemoAudioData;
  readonly viewStartFrac: number;
  readonly viewEndFrac: number;
}

export function Minimap({ data, viewStartFrac, viewEndFrac }: MinimapProps) {
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

    // Background
    gfx.fillStyle = "#020204";
    gfx.fillRect(0, 0, width, height);

    // Draw waveform from demo data
    const channelData = data.waveform[0];

    if (channelData) {
      const centerY = height / 2;

      gfx.fillStyle = "#6E6E78";

      for (let px = 0; px < width; px++) {
        const frameIndex = Math.floor((px / width) * data.timeFrames);
        const clamped = Math.max(0, Math.min(data.timeFrames - 1, frameIndex));
        const frame = channelData[clamped];

        if (!frame) continue;

        const top = centerY - Math.abs(frame.max) * centerY * 0.8;
        const bot = centerY + Math.abs(frame.min) * centerY * 0.8;
        const minY = Math.min(top, bot);
        const lineHeight = Math.max(1, Math.abs(bot - top));

        gfx.fillRect(px, minY, 1, lineHeight);
      }
    }

    // Draw dimmed areas outside viewbox
    const vpStart = viewStartFrac * width;
    const vpEnd = viewEndFrac * width;

    gfx.fillStyle = "rgba(0, 0, 0, 0.55)";
    gfx.fillRect(0, 0, vpStart, height);
    gfx.fillRect(vpEnd, 0, width - vpEnd, height);

    // Viewbox border
    gfx.strokeStyle = "#5A9ECF";
    gfx.lineWidth = 1;
    gfx.strokeRect(vpStart + 0.5, 0.5, vpEnd - vpStart - 1, height - 1);
  }, [data, viewStartFrac, viewEndFrac]);

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
    <div className="h-10 bg-void">
      <canvas
        ref={canvasRef}
        className="h-full w-full"
      />
    </div>
  );
}
