import { useState, useEffect, useRef } from 'react';

const LAVA_GRADIENT = [
  'rgb(0,0,0) 0%',
  'rgb(5,5,30) 9%',
  'rgb(15,20,70) 18%',
  'rgb(30,15,50) 27%',
  'rgb(80,10,5) 36%',
  'rgb(140,20,0) 45%',
  'rgb(185,55,0) 55%',
  'rgb(215,100,5) 64%',
  'rgb(240,155,25) 73%',
  'rgb(252,210,70) 82%',
  'rgb(255,240,140) 91%',
  'rgb(255,255,255) 100%',
].join(', ');

export const Meter = ({
  level,
  height = 80,
  width = 4,
  animated = false,
  className,
}: {
  readonly level: number;
  readonly height?: number;
  readonly width?: number;
  readonly animated?: boolean;
  readonly className?: string;
}) => {
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
        style={{ background: `linear-gradient(to top, ${LAVA_GRADIENT})` }}
      />
      <div
        className="absolute top-0 w-full bg-void"
        style={{ height: `${(1 - displayLevel) * 100}%` }}
      />
    </div>
  );
};
