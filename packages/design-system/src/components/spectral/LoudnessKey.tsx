import type { ColormapTheme } from "../../colors";
import { getThemeColors } from "../../colors";

interface LoudnessKeyProps {
  readonly colormap?: ColormapTheme;
}

export function LoudnessKey({ colormap = "lava" }: LoudnessKeyProps) {
  const themeColors = getThemeColors(colormap);

  const legendItems = [
    { label: "Waveform", color: themeColors.waveformCss },
    { label: "LUFS", color: themeColors.loudness.integrated },
    { label: "RMS", color: themeColors.loudness.rms },
    { label: "Peak", color: themeColors.loudness.truePeak },
  ];

  return (
    <div className="flex gap-4 py-1 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
      {legendItems.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2"
            style={{ backgroundColor: item.color }}
          />
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
