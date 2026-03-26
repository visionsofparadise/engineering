import { useState, useRef, useEffect } from "react";
import { Icon } from "@iconify/react";

export type MenuItem = {
  readonly kind: "action";
  readonly label: string;
  readonly icon?: string;
  readonly shortcut?: string;
  readonly color?: string;
  readonly onClick?: () => void;
} | {
  readonly kind: "separator";
};

export interface DropdownButtonProps {
  readonly trigger: React.ReactNode;
  readonly items: ReadonlyArray<MenuItem>;
  readonly align?: "left" | "right";
  readonly className?: string;
}

export function DropdownButton({ trigger, items, align = "left", className }: DropdownButtonProps) {
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
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {open && (
        <div
          className={`absolute top-full z-50 mt-1 flex min-w-72 flex-col bg-chrome-raised py-1 ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((item, index) => {
            if (item.kind === "separator") {
              return (
                <div key={`sep-${index}`} className="h-px bg-chrome-border-subtle mx-2 my-1" />
              );
            }

            return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  item.onClick?.();
                  setOpen(false);
                }}
                className={`flex items-center gap-2 mx-2 my-0.5 text-left font-technical uppercase tracking-[0.06em] text-sm hover:bg-interactive-hover ${item.color ?? "text-chrome-text"}`}
              >
                {item.icon && <Icon icon={item.icon} width={12} height={12} className="shrink-0" />}
                <span className="flex-1">{item.label}</span>
                {item.shortcut && (
                  <span className="shrink-0 text-[length:var(--text-xs)] normal-case tracking-normal text-chrome-text-dim">{item.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
