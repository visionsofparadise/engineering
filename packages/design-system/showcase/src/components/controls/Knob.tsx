import { useState, useCallback, useRef } from 'react';

export const Knob = ({
  value,
  label,
  size = 40,
  onChange,
  className,
  hideValue,
}: {
  readonly value: number;
  readonly label: string;
  readonly size?: number;
  readonly onChange?: (v: number) => void;
  readonly className?: string;
  readonly hideValue?: boolean;
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startValue = useRef(0);

  const radius = (size - 4) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 135;
  const totalSweep = 270;
  const valueSweep = totalSweep * value;

  const polarToCartesian = (angle: number) => {
    const rad = (angle * Math.PI) / 180;

    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  };

  const arcPath = (start: number, sweep: number) => {
    if (sweep <= 0) return '';
    const end = start + sweep;
    const sp = polarToCartesian(start);
    const ep = polarToCartesian(end);
    const largeArc = sweep > 180 ? 1 : 0;

    return `M ${sp.x} ${sp.y} A ${radius} ${radius} 0 ${largeArc} 1 ${ep.x} ${ep.y}`;
  };

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
      const delta = (startY.current - ev.clientY) / 150;

      onChange(Math.max(0, Math.min(1, startValue.current + delta)));
    },
    [dragging, onChange],
  );

  const onPointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  return (
    <div className={`flex flex-col items-center gap-1${className ? ` ${className}` : ''}`}>
      {!hideValue && <span className="font-technical text-[length:var(--text-xs)] uppercase text-chrome-text-secondary">{Math.round(value * 100)}</span>}
      <svg
        ref={svgRef}
        width={size}
        height={size}
        style={{ display: 'block', width: size, height: size }}
        className={onChange ? 'cursor-pointer' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <path
          d={arcPath(startAngle, totalSweep)}
          fill="none"
          style={{ stroke: '#28282E', strokeWidth: 3, strokeLinecap: 'round' }}
        />
        {valueSweep > 0 && (
          <path
            d={arcPath(startAngle, valueSweep)}
            fill="none"
            style={{ stroke: '#B8B8C0', strokeWidth: 3, strokeLinecap: 'round' }}
          />
        )}
      </svg>
      {label && <span className="font-technical text-[length:var(--text-xs)] uppercase text-chrome-text-secondary">{label}</span>}
    </div>
  );
};
