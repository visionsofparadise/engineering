import { useRef, useEffect, useCallback } from "react";

// --- Frequency Axis (left side, fixed) ---

const FREQ_LABELS: ReadonlyArray<{ hz: number; label: string }> = [
  { hz: 100, label: "100" },
  { hz: 200, label: "200" },
  { hz: 500, label: "500" },
  { hz: 1000, label: "1k" },
  { hz: 2000, label: "2k" },
  { hz: 5000, label: "5k" },
  { hz: 10000, label: "10k" },
  { hz: 20000, label: "20k" },
];

const FREQ_MIN = 20;
const FREQ_MAX = 22050;

// Mel scale — matches spectral-display package
function freqToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

function freqToY(hz: number): number {
  const melMin = freqToMel(FREQ_MIN);
  const melMax = freqToMel(FREQ_MAX);
  const melHz = freqToMel(hz);

  return 1 - (melHz - melMin) / (melMax - melMin);
}

export function FrequencyAxis() {
  return (
    <div
      className="relative bg-void font-technical text-chrome-text-secondary"
      style={{
        fontSize: "var(--text-xs)",
        letterSpacing: "0.02em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {FREQ_LABELS.map(({ hz, label }) => {
        const yPct = freqToY(hz) * 100;

        return (
          <div key={hz} className="absolute right-0 flex items-center" style={{ top: `${yPct}%`, transform: "translateY(-50%)" }}>
            <span className="pr-1">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// --- dB Axis Labels (right side of display, no colormap) ---

// Symmetric waveform amplitude axis: 0dB at top and bottom, -∞ at center
// Position by linear amplitude: amplitude = 10^(dB/20), so -6dB ≈ 0.5, -12dB ≈ 0.25, etc.
const DB_HALF_LABELS = [0, -3, -6, -12, -24];

function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

export function DbAxis() {
  return (
    <div
      className="relative w-8 bg-void font-technical text-chrome-text-secondary"
      style={{
        fontSize: "var(--text-xs)",
        letterSpacing: "0.02em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {/* Top half: 0dB near top → approaching 50% center */}
      {DB_HALF_LABELS.map((db) => {
        const amp = db === 0 ? 1 : dbToLinear(db);
        const yPct = (1 - amp) * 50;

        return (
          <div
            key={`t${db}`}
            className="absolute left-0 flex items-center"
            style={{
              top: db === 0 ? "0px" : `${yPct}%`,
              transform: db === 0 ? undefined : "translateY(-50%)",
            }}
          >
            <span className="pl-1">{db}</span>
          </div>
        );
      })}

      {/* Center: -∞ */}
      <div className="absolute left-0 flex items-center" style={{ top: "50%", transform: "translateY(-50%)" }}>
        <span className="pl-1">-∞</span>
      </div>

      {/* Bottom half: mirror */}
      {DB_HALF_LABELS.map((db) => {
        const amp = db === 0 ? 1 : dbToLinear(db);
        const yPct = 50 + amp * 50;

        return (
          <div
            key={`b${db}`}
            className="absolute left-0 flex items-center"
            style={{
              bottom: db === 0 ? "0px" : undefined,
              top: db === 0 ? undefined : `${yPct}%`,
              transform: db === 0 ? undefined : "translateY(-50%)",
            }}
          >
            <span className="pl-1">{db}</span>
          </div>
        );
      })}
    </div>
  );
}

// --- Colormap Gradient Strip (separate from dB axis) ---

interface ColormapStop {
  readonly pos: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

const LAVA_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [5, 5, 30], [15, 20, 70], [30, 15, 50],
  [80, 10, 5], [140, 20, 0], [185, 55, 0], [215, 100, 5],
  [240, 155, 25], [252, 210, 70], [255, 240, 140], [255, 255, 255],
];

const COLORMAP: ReadonlyArray<ColormapStop> = LAVA_POINTS.map((rgb, index) => ({
  pos: index / (LAVA_POINTS.length - 1),
  r: rgb[0],
  g: rgb[1],
  b: rgb[2],
}));

function interpolateColor(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  const fallback = COLORMAP[0] ?? { pos: 0, r: 0, g: 0, b: 0 };
  let lo = fallback;
  let hi = COLORMAP[COLORMAP.length - 1] ?? fallback;

  for (let si = 0; si < COLORMAP.length - 1; si++) {
    const lower = COLORMAP[si] ?? fallback;
    const upper = COLORMAP[si + 1] ?? fallback;

    if (clamped >= lower.pos && clamped <= upper.pos) {
      lo = lower;
      hi = upper;
      break;
    }
  }

  const range = hi.pos - lo.pos;
  const tx = range > 0 ? (clamped - lo.pos) / range : 0;

  const red = Math.round(lo.r + (hi.r - lo.r) * tx);
  const green = Math.round(lo.g + (hi.g - lo.g) * tx);
  const blue = Math.round(lo.b + (hi.b - lo.b) * tx);

  return `rgb(${red},${green},${blue})`;
}

export function ColormapGradient() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const stripWidth = 10;

  const renderColormap = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;

    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = Math.round(stripWidth * dpr);
    const ch = Math.round(container.clientHeight * dpr);

    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const gfx = canvas.getContext("2d");

    if (!gfx) return;

    for (let py = 0; py < ch; py++) {
      // Top = silence (0), bottom = loud (1) — matches bottom half of symmetric dB axis
      const normalized = py / ch;

      gfx.fillStyle = interpolateColor(normalized);
      gfx.fillRect(0, py, cw, 1);
    }
  }, []);

  useEffect(() => {
    renderColormap();

    const container = containerRef.current;

    if (!container) return;

    const observer = new ResizeObserver(() => {
      renderColormap();
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [renderColormap]);

  return (
    <div
      ref={containerRef}
      className="shrink-0 flex-1 bg-void"
      style={{ width: stripWidth }}
    >
      <canvas
        ref={canvasRef}
        className="h-full shrink-0"
        style={{ width: stripWidth }}
      />
    </div>
  );
}

// --- Time Ruler (top of display area) ---

interface TimeRulerProps {
  readonly startMs: number;
  readonly endMs: number;
}

function formatRulerTime(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const frac = Math.floor(totalSeconds * 10 % 10);

  return `${minutes}:${seconds.toString().padStart(2, "0")}.${frac}`;
}

export function TimeRuler({ startMs, endMs }: TimeRulerProps) {
  const spanMs = endMs - startMs;

  // Major tick interval (labeled)
  let majorMs = 5000;

  if (spanMs < 2000) majorMs = 200;
  else if (spanMs < 5000) majorMs = 500;
  else if (spanMs < 10000) majorMs = 1000;
  else if (spanMs < 30000) majorMs = 2000;
  else if (spanMs < 60000) majorMs = 5000;
  else majorMs = 10000;

  // Minor tick interval (unlabeled) — subdivide major by 5 or 4
  const minorMs = majorMs <= 200 ? majorMs / 4 : majorMs / 5;

  // Collect major ticks
  const majorTicks: Array<{ timeMs: number; label: string }> = [];
  const firstMajor = Math.ceil(startMs / majorMs) * majorMs;

  for (let tick = firstMajor; tick <= endMs; tick += majorMs) {
    majorTicks.push({ timeMs: tick, label: formatRulerTime(tick) });
  }

  // Collect minor ticks (exclude positions that overlap with major)
  const minorTicks: Array<number> = [];
  const firstMinor = Math.ceil(startMs / minorMs) * minorMs;

  for (let tick = firstMinor; tick <= endMs; tick += minorMs) {
    if (tick % majorMs !== 0) {
      minorTicks.push(tick);
    }
  }

  return (
    <div
      className="relative h-8 bg-void font-technical text-chrome-text-secondary"
      style={{
        fontSize: "var(--text-xs)",
        letterSpacing: "0.02em",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {/* Minor ticks */}
      {minorTicks.map((timeMs) => {
        const fraction = (timeMs - startMs) / spanMs;

        return (
          <div
            key={`m${timeMs}`}
            className="absolute bottom-0 h-1.5 w-px bg-chrome-border-subtle"
            style={{ left: `${fraction * 100}%` }}
          />
        );
      })}

      {/* Major ticks with labels */}
      {majorTicks.map(({ timeMs, label }) => {
        const fraction = (timeMs - startMs) / spanMs;

        return (
          <div
            key={timeMs}
            className="absolute bottom-0"
            style={{ left: `${fraction * 100}%` }}
          >
            <span className="absolute bottom-0 left-0 h-2.5 w-px bg-chrome-border" />
            <span className="absolute bottom-0.5 left-1.5">{label}</span>
          </div>
        );
      })}

      <div className="absolute bottom-0 left-0 right-0 h-px bg-chrome-border-subtle" />
    </div>
  );
}
