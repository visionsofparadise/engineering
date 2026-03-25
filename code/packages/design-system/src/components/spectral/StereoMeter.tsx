import type { ColormapTheme } from "../../colors";
import { getThemeColors } from "../../colors";

const TRACK_COLOR = "#1E1E23";
const FADER_LEVEL = 85;
const LEVEL_L = 82;
const LEVEL_R = 75;

interface StereoMeterProps {
  readonly colormap?: ColormapTheme;
  readonly className?: string;
}

export function StereoMeter({ colormap = "lava", className }: StereoMeterProps) {
  const meterFill = getThemeColors(colormap).meterGradient;

  return (
    <div className={`relative flex h-full items-end justify-center gap-1 ${className ?? ""}`}>
      <div className="relative h-full w-[3px]" style={{ backgroundColor: TRACK_COLOR }}>
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ height: `${LEVEL_L}%`, background: meterFill }}
        />
      </div>
      <div className="relative h-full w-[3px]" style={{ backgroundColor: TRACK_COLOR }}>
        <div
          className="absolute inset-x-0 bottom-0"
          style={{ height: `${LEVEL_R}%`, background: meterFill }}
        />
      </div>
      {/* Gain fader thumb */}
      <div
        className="absolute left-1/2 h-[3px] w-[18px] -translate-x-1/2 bg-chrome-text"
        style={{ bottom: `${FADER_LEVEL}%` }}
      />
    </div>
  );
}
