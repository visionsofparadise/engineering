const LEGEND_ITEMS = [
  { label: "Waveform", color: "#60D4F0" },
  { label: "LUFS", color: "#A3E635" },
  { label: "RMS", color: "#A78BFA" },
  { label: "Peak", color: "#E879F9" },
] as const;

export function LoudnessKey() {
  return (
    <div className="flex gap-4 py-1 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-secondary">
      {LEGEND_ITEMS.map((item) => (
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
