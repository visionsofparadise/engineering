export interface InputProps {
  readonly type?: "text" | "number";
  readonly label?: string;
  readonly value?: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly onChange?: (value: string) => void;
  readonly className?: string;
}

export function Input({
  type = "text",
  label,
  value,
  defaultValue,
  placeholder,
  onChange,
  className,
}: InputProps) {
  const fontClass = type === "number"
    ? "font-technical tabular-nums"
    : "font-body";

  return (
    <div className={`flex flex-col gap-1${className ? ` ${className}` : ""}`}>
      {label && (
        <label className="font-technical uppercase tracking-[0.08em] text-chrome-text-secondary text-xs">
          {label}
        </label>
      )}
      <input
        type={type}
        value={value}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className={`bg-void px-2 py-1.5 text-chrome-text outline-none focus:ring-1 focus:ring-primary ${fontClass}`}
      />
    </div>
  );
}
