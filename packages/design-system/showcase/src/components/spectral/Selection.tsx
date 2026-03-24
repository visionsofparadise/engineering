interface SelectionProps {
  readonly startFraction: number;
  readonly endFraction: number;
}

export function Selection({ startFraction, endFraction }: SelectionProps) {
  const left = `${startFraction * 100}%`;
  const width = `${(endFraction - startFraction) * 100}%`;

  return (
    <div
      className="absolute top-0 bottom-0"
      style={{ left, width }}
    >
      <div className="absolute inset-0 bg-data-selection" />
      <div className="absolute top-0 bottom-0 left-0 w-[1px] bg-data-selection-border" />
      <div className="absolute top-0 bottom-0 right-0 w-[1px] bg-data-selection-border" />
    </div>
  );
}
