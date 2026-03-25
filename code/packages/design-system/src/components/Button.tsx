import { cn } from "../cn";

export interface ButtonProps extends React.ComponentProps<"button"> {
  readonly variant?: "primary" | "secondary" | "ghost";
  readonly size?: "sm" | "default" | "lg" | "xl";
}

const sizeStyles = {
  sm: "px-1.5 py-0.5 text-[length:var(--text-xs)]",
  default: "px-2 py-1 text-[length:var(--text-sm)]",
  lg: "px-3 py-1.5 text-[length:var(--text-base)]",
  xl: "px-4 py-2 text-[length:var(--text-md)]",
};

export function Button({ variant = "primary", size = "default", className, children, ...props }: ButtonProps) {
  if (variant === "ghost") {
    return (
      <button
        type="button"
        {...props}
        className={cn(
          "font-technical uppercase tracking-[0.06em] text-chrome-text-secondary hover:text-chrome-text",
          sizeStyles[size],
          props.disabled && "text-chrome-text-dim cursor-not-allowed",
          className,
        )}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      type="button"
      {...props}
      className={cn(
        "flex items-center font-technical uppercase tracking-[0.06em]",
        sizeStyles[size],
        variant === "primary" && "text-void",
        variant === "secondary" && "text-chrome-text",
        props.disabled && "text-chrome-text-dim cursor-not-allowed",
        className,
      )}
    >
      <span className={cn(
        "flex items-center",
        variant === "primary" && "bg-primary",
        variant === "secondary" && "bg-secondary",
      )}>
        {children}
      </span>
    </button>
  );
}
