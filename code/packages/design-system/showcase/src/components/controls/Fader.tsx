import { useState, useCallback, useRef } from 'react';

export const Fader = ({
  value,
  label,
  height = 80,
  width = 24,
  onChange,
  className,
}: {
  readonly value: number;
  readonly label: string;
  readonly height?: number;
  readonly width?: number;
  readonly onChange?: (v: number) => void;
  readonly className?: string;
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const onPointerDown = useCallback(
    (ev: React.PointerEvent) => {
      if (!onChange) return;
      setDragging(true);
      (ev.target as Element).setPointerCapture(ev.pointerId);
      startY.current = ev.clientY;
      startValue.current = value;
    },
    [onChange, value],
  );

  const onPointerMove = useCallback(
    (ev: React.PointerEvent) => {
      if (!dragging || !onChange) return;
      const delta = (startY.current - ev.clientY) / height;

      onChange(Math.max(0, Math.min(1, startValue.current + delta)));
    },
    [dragging, onChange, height],
  );

  const onPointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div className={`flex flex-col items-center gap-2${className ? ` ${className}` : ''}`}>
      <div
        ref={trackRef}
        className="relative flex justify-center"
        style={{ width, height, cursor: onChange ? 'ns-resize' : undefined }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="absolute left-1/2 -translate-x-px bg-void" style={{ width: 1, height: '100%' }} />
        <div
          className="absolute bg-chrome-text"
          style={{
            width: 12,
            height: 4,
            left: '50%',
            bottom: `${value * 100}%`,
            transform: 'translate(-50%, 50%)',
          }}
        />
      </div>
      <span className="font-technical text-[length:var(--text-xs)] uppercase text-chrome-text-secondary">{label}</span>
    </div>
  );
};
