import { Icon } from "@iconify/react";

export function ZoomSliders() {
  return (
    <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1.5">
      {/* Horizontal zoom */}
      <div className="flex items-center gap-1.5">
        <Icon icon="lucide:move-horizontal" width={12} height={12} className="text-chrome-text-dim" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          defaultValue={0.4}
          className="h-0.5 w-16"
          aria-label="Horizontal zoom"
          style={{ accentColor: "var(--chrome-text-secondary)" }}
        />
      </div>
      {/* Vertical zoom */}
      <div className="flex items-center gap-1.5">
        <Icon icon="lucide:move-vertical" width={12} height={12} className="text-chrome-text-dim" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          defaultValue={0.5}
          className="h-0.5 w-16"
          aria-label="Vertical zoom"
          style={{ accentColor: "var(--chrome-text-secondary)" }}
        />
      </div>
    </div>
  );
}
