export const ButtonSelection = ({
  options,
  active,
  onSelect,
  columns,
  className,
}: {
  readonly options: ReadonlyArray<string>;
  readonly active: string;
  readonly onSelect?: (option: string) => void;
  readonly columns?: number;
  readonly className?: string;
}) => (
  <div
    className={`${columns ? 'grid' : 'flex flex-wrap'}${className ? ` ${className}` : ''}`}
    style={columns ? { gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '0.5rem' } : { gap: '0.5rem' }}
  >
    {options.map((option) => (
      <button
        key={option}
        onClick={() => onSelect?.(option)}
        className={`font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] transition-colors cursor-pointer border-none ${
          option === active
            ? 'bg-secondary text-chrome-text'
            : 'text-chrome-text-secondary hover:text-chrome-text'
        }`}
        aria-label={option}
      >
        {option}
      </button>
    ))}
  </div>
);
