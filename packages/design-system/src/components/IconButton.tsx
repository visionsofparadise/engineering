import { Icon } from "@iconify/react";
import type { ComponentPropsWithoutRef } from "react";

type ButtonProps = ComponentPropsWithoutRef<"button">;

interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label"> {
  readonly icon: string;
  readonly label: string;
  readonly size?: number;
  readonly variant?: "raised" | "ghost";
  readonly active?: boolean;
  readonly activeVariant?: "raised" | "primary" | "secondary";
  readonly dim?: boolean;
}

export function IconButton({
  icon,
  label,
  size = 14,
  variant = "raised",
  active,
  activeVariant = "raised",
  dim,
  disabled,
  className,
  type = "button",
  ...buttonProps
}: IconButtonProps) {
  const isDimmed = dim === true || disabled === true;

  const textColor = isDimmed
    ? "text-chrome-text-dim"
    : active
      ? (activeVariant === "primary" ? "text-void" : "text-chrome-text")
      : "text-chrome-text-secondary hover:text-chrome-text";

  const bgClass = active
    ? (activeVariant === "primary" ? "bg-primary" : activeVariant === "secondary" ? "bg-secondary" : "bg-chrome-raised")
    : variant === "raised" ? "bg-chrome-raised" : "";

  const disabledClass = disabled ? " cursor-not-allowed" : "";

  return (
    <button
      {...buttonProps}
      type={type}
      disabled={disabled}
      aria-label={label}
      className={`flex items-center justify-center px-1 py-1.5 ${textColor}${disabledClass}${className ? ` ${className}` : ""}`}
    >
      <span className={`flex items-center justify-center py-1 ${bgClass}`}>
        <Icon icon={icon} width={size} height={size} />
      </span>
    </button>
  );
}
