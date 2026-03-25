import { useState, useEffect, useRef } from 'react';
import type { ColormapTheme } from '../../colors';
import { getThemeColors } from '../../colors';

export const Meter = ({
  level,
  height = 80,
  width = 4,
  animated = false,
  colormap = "lava",
  className,
}: {
  readonly level: number;
  readonly height?: number;
  readonly width?: number;
  readonly animated?: boolean;
  readonly colormap?: ColormapTheme;
  readonly className?: string;
}) => {
  const gradient = getThemeColors(colormap).meterGradient;
  const [displayLevel, setDisplayLevel] = useState(level);
  const levelRef = useRef(displayLevel);

  useEffect(() => {
    if (!animated) {
      setDisplayLevel(level);

      return;
    }

    levelRef.current = level;
    let frameId: number;
    let lastTime = 0;

    const tick = (time: number) => {
      if (time - lastTime >= 60) {
        lastTime = time;
        setDisplayLevel((prev) => {
          const next = prev + (Math.random() - 0.5) * 0.15;

          return Math.max(0, Math.min(1, next));
        });
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frameId);
  }, [animated, level]);

  return (
    <div className={`relative overflow-hidden${className ? ` ${className}` : ''}`} style={{ width, height }}>
      <div
        className="absolute inset-0"
        style={{ background: gradient }}
      />
      <div
        className="absolute top-0 w-full bg-void"
        style={{ height: `${(1 - displayLevel) * 100}%` }}
      />
    </div>
  );
};
