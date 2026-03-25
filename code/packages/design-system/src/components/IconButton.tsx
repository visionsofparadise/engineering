import { Icon } from "@iconify/react";

interface IconButtonProps {
  readonly icon: string;
  readonly label: string;
  readonly size?: number;
  readonly variant?: "raised" | "ghost";
  readonly active?: boolean;
  readonly activeVariant?: "raised" | "primary" | "secondary";
  readonly dim?: boolean;
  readonly onClick?: () => void;
  readonly className?: string;
}

export function IconButton({
  icon,
  label,
  size = 14,
  variant = "raised",
  active,
  activeVariant = "raised",
  dim,
  onClick,
  className,
}: IconButtonProps) {
  const textColor = dim
    ? "text-chrome-text-dim"
    : active
      ? (activeVariant === "primary" ? "text-void" : "text-chrome-text")
      : "text-chrome-text-secondary hover:text-chrome-text";

  const bgClass = active
    ? (activeVariant === "primary" ? "bg-primary" : activeVariant === "secondary" ? "bg-secondary" : "bg-chrome-raised")
    : variant === "raised" ? "bg-chrome-raised" : "";

  return (
    <button
      type="button"
      className={`flex items-center justify-center px-1 py-1.5 ${textColor}${className ? ` ${className}` : ""}`}
      aria-label={label}
      onClick={onClick}
    >
      <span className={`flex items-center justify-center py-1 ${bgClass}`}>
        <Icon icon={icon} width={size} height={size} />
      </span>
    </button>
  );
}
