import { Icon } from "@iconify/react";
import { IconButton } from "../IconButton";

function TransportButton({
  icon,
  label,
  large,
  active,
}: {
  readonly icon: string;
  readonly label: string;
  readonly large?: boolean;
  readonly active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex items-center justify-center px-1 py-1.5 ${
        active
          ? "text-chrome-text"
          : "text-chrome-text-secondary hover:text-chrome-text"
      }`}
      aria-label={label}
    >
      <span className={`flex items-center justify-center py-1 ${active ? "bg-chrome-raised" : ""}`}>
        <Icon icon={icon} width={large ? 22 : 16} height={large ? 22 : 16} />
      </span>
    </button>
  );
}

function CursorModeButton({
  icon,
  label,
  active,
}: {
  readonly icon: string;
  readonly label: string;
  readonly active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`flex items-center justify-center px-1 py-1.5 ${
        active
          ? "text-chrome-text"
          : "text-chrome-text-dim hover:text-chrome-text-secondary"
      }`}
      aria-label={label}
    >
      <span className={`flex items-center justify-center py-1 ${active ? "bg-chrome-raised" : ""}`}>
        <Icon icon={icon} width={20} height={20} />
      </span>
    </button>
  );
}

function Readout({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">
        {label}
      </span>
      <span className="font-technical text-[length:var(--text-sm)] tabular-nums text-chrome-text">
        {value}
      </span>
    </div>
  );
}

function ReadoutColumn({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">
        {label}
      </span>
      <span className="font-technical text-[length:var(--text-sm)] tabular-nums text-chrome-text">
        {value}
      </span>
    </div>
  );
}

interface TransportProps {
  readonly cursorTime?: string;
  readonly cursorFreq?: string;
  readonly cursorAmp?: string;
}

export function Transport({
  cursorTime = "00:01:32.450",
  cursorFreq = "440 Hz",
  cursorAmp = "-24.5 dB",
}: TransportProps) {
  return (
    <div className="relative flex items-center bg-void px-4 py-3">
      {/* Left: Stats -- cursor readout, loudness, frequency, format */}
      <div className="z-10 flex shrink-0 items-center">
        {/* Cursor readout */}
        <div className="flex flex-col pr-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">Time</span>
            <span className="font-technical text-[length:var(--text-sm)] tabular-nums text-chrome-text">{cursorTime}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">Freq</span>
            <span className="font-technical text-[length:var(--text-sm)] tabular-nums text-chrome-text">{cursorFreq}</span>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">Amp</span>
            <span className="font-technical text-[length:var(--text-sm)] tabular-nums text-chrome-text">{cursorAmp}</span>
          </div>
        </div>

        {/* Loudness */}
        <div className="flex items-center gap-3 border-l border-chrome-border-subtle px-4">
          <ReadoutColumn label="True Peak" value="-1.2 dBTP" />
          <ReadoutColumn label="Peak" value="-3.1 dB" />
          <ReadoutColumn label="Integrated" value="-16.2 LUFS" />
          <ReadoutColumn label="Range" value="12.4 LU" />
        </div>

        {/* Frequency */}
        <div className="hidden flex-col gap-0.5 border-l border-chrome-border-subtle px-4 wide:flex">
          <Readout label="Low" value="20 Hz" />
          <Readout label="High" value="20.0 kHz" />
          <Readout label="Range" value="20.0 kHz" />
        </div>

        {/* Format */}
        <div className="flex flex-col gap-0.5 border-l border-chrome-border-subtle px-4">
          <Readout label="Rate" value="44100" />
          <Readout label="Depth" value="24-bit" />
        </div>
      </div>

      {/* Center: Media controls -- absolutely centered */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="flex items-center gap-1.5">
          <div className="flex items-center">
            <TransportButton icon="lucide:skip-back" label="Skip to start" />
            <TransportButton icon="lucide:chevrons-left" label="Jump back" />
            <TransportButton icon="lucide:chevron-left" label="Frame back" />
            <TransportButton icon="lucide:play" label="Play" large />
            <TransportButton icon="lucide:chevron-right" label="Frame forward" />
            <TransportButton icon="lucide:chevrons-right" label="Jump forward" />
            <TransportButton icon="lucide:skip-forward" label="Skip to end" />
          </div>

          {/* Loop */}
          <IconButton icon="lucide:repeat" label="Loop" size={16} variant="ghost" dim />
        </div>

        {/* Speed + Timecode */}
        <div className="mt-1 flex items-center gap-4">
          <button
            type="button"
            className="flex items-center gap-0.5 px-2 py-0.5 font-technical text-[length:var(--text-sm)] italic text-chrome-text"
          >
            <span className="flex items-center gap-0.5 bg-chrome-raised">
              <span>1x</span>
              <Icon icon="lucide:chevron-down" width={12} height={12} />
            </span>
          </button>
          <span className="font-technical text-[length:var(--text-sm)] tabular-nums text-chrome-text">
            01:32.450
            <span className="text-chrome-text-dim"> / </span>
            30:00.000
          </span>
        </div>
      </div>

      {/* Right: Actions -- selection info, snap, cursor modes, apply */}
      <div className="z-10 ml-auto flex shrink-0 items-center gap-2">
        {/* Selection info */}
        <div className="flex items-center gap-3">
          <div className="flex flex-col">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">Selection</span>
            <span className="font-technical text-[length:var(--text-sm)] tabular-nums text-chrome-text">00:00.450 – 00:01.200</span>
          </div>
          <div className="flex flex-col">
            <span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">Freq</span>
            <span className="font-technical text-[length:var(--text-sm)] tabular-nums text-chrome-text">200 Hz – 4.2 kHz</span>
          </div>
        </div>
        <div className="h-6 w-px bg-chrome-border-subtle" />
        {/* Snap */}
        <IconButton icon="lucide:magnet" label="Snap to zero crossing" size={16} variant="ghost" dim />
        <div className="h-6 w-px bg-chrome-border-subtle" />
        {/* Cursor modes -- collapsed on small screens */}
        <button
          type="button"
          className="flex items-center gap-0.5 px-1 py-1.5 text-chrome-text wide:hidden"
          aria-label="Cursor mode"
        >
          <span className="flex items-center gap-0.5 bg-chrome-raised py-1">
            <Icon icon="lucide:text-cursor" width={20} height={20} />
            <Icon icon="lucide:chevron-down" width={12} height={12} />
          </span>
        </button>
        {/* Cursor modes -- expanded on large screens */}
        <div className="hidden items-center wide:flex">
          <CursorModeButton icon="lucide:text-cursor" label="Time select" active />
          <CursorModeButton icon="lucide:square-dashed-mouse-pointer" label="Frequency select" />
          <CursorModeButton icon="lucide:lasso" label="Frequency lasso" />
          <CursorModeButton icon="lucide:paintbrush" label="Frequency brush" />
          <CursorModeButton icon="lucide:hand" label="Pan" />
          <CursorModeButton icon="lucide:search" label="Zoom" />
        </div>
        <div className="h-6 w-px bg-chrome-border-subtle" />
        {/* Apply */}
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 px-2 py-1 font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-void"
          aria-label="Apply inline transform"
        >
          <span className="flex items-center gap-1.5 bg-primary">
            <Icon icon="lucide:wand-sparkles" width={16} height={16} />
            <span>Apply</span>
            <Icon icon="lucide:chevron-down" width={12} height={12} />
          </span>
        </button>
      </div>
    </div>
  );
}
