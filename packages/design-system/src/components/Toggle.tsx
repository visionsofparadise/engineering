export function Toggle({
  value,
  label,
  onChange,
  className,
}: {
  readonly value: boolean;
  readonly label?: string;
  readonly onChange?: (value: boolean) => void;
  readonly className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange?.(!value)}
      className={`font-technical uppercase tracking-[0.06em] text-xs px-2 py-1 ${value ? "bg-secondary text-chrome-text" : "bg-void text-chrome-text-secondary"}${className ? ` ${className}` : ""}`}
    >
      {label}
    </button>
  );
}
