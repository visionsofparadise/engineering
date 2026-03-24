import * as React from "react"

import { cn } from "../../utils/cn"

interface ButtonBankProps {
  value: string
  onValueChange: (value: string) => void
  options: ReadonlyArray<string>
  disabled?: boolean
  className?: string
}

const ButtonBank = React.forwardRef<HTMLDivElement, ButtonBankProps>(
  ({ value, onValueChange, options, disabled, className }, ref) => (
    <div ref={ref} className={cn("flex flex-wrap gap-1.5", className)}>
      {options.map((option) => {
        const isActive = option === value

        return (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onValueChange(option)}
            className={cn(
              "rounded border-2 px-2.5 py-1 font-mono text-[0.625rem] uppercase transition-all",
              "bg-muted active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
              isActive
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
            style={{
              boxShadow: isActive
                ? [
                    'inset 0 2px 4px rgba(0,0,0,0.25)',
                    'inset 0 1px 2px rgba(0,0,0,0.15)',
                    '0 0 4px var(--color-primary)',
                  ].join(', ')
                : [
                    'inset 0 2px 3px -1px rgba(255,255,255,0.15)',
                    'inset 0 -2px 3px -1px rgba(0,0,0,0.25)',
                    '0 1px 2px rgba(0,0,0,0.15)',
                  ].join(', '),
              textShadow: isActive
                ? '0 0 6px var(--color-primary)'
                : undefined,
            }}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
)

ButtonBank.displayName = "ButtonBank"

export { ButtonBank }
