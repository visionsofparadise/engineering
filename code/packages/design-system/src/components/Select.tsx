import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";

export interface SelectProps {
  readonly value: string;
  readonly options: ReadonlyArray<string>;
  readonly onSelect?: (value: string) => void;
  readonly className?: string;
}

export function Select({ value, options, onSelect, className }: SelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as globalThis.Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 bg-chrome-raised font-technical uppercase text-xs text-chrome-text px-2 py-1"
      >
        <span>{value}</span>
        <Icon icon="lucide:chevron-down" width={12} height={12} />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 flex flex-col bg-chrome-raised py-1">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                onSelect?.(option);
                setOpen(false);
              }}
              className="px-3 py-1.5 text-left font-technical uppercase text-xs text-chrome-text hover:bg-interactive-hover"
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
