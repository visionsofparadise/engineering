import * as React from "react"
import * as SwitchPrimitives from "@radix-ui/react-switch"

import { cn } from "../../utils/cn"

const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitives.Root
    className={cn(
     "peer inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
     "border-border bg-muted",
     "active:translate-y-px",
      className
    )}
    style={{
      boxShadow: [
        /* convex highlight — top edge catches light */
        'inset 0 2px 3px -1px rgba(255,255,255,0.15)',
        /* convex shadow — bottom edge in shadow */
        'inset 0 -2px 3px -1px rgba(0,0,0,0.25)',
        /* left highlight */
        'inset 2px 0 2px -1px rgba(255,255,255,0.06)',
        /* right shadow */
        'inset -2px 0 2px -1px rgba(0,0,0,0.1)',
        /* outer recess it sits in */
        '0 1px 2px rgba(0,0,0,0.15)',
      ].join(', '),
    }}
    {...props}
    ref={ref}
  >
    <SwitchPrimitives.Thumb
      className={cn(
       "pointer-events-none block h-3 w-3 rounded-full transition-all duration-[var(--duration-ui)]",
       "bg-muted-foreground/30",
       "data-[state=checked]:bg-primary data-[state=checked]:shadow-[0_0_6px_3px_var(--color-primary)]",
      )}
    />
  </SwitchPrimitives.Root>
))
Switch.displayName = SwitchPrimitives.Root.displayName

export { Switch }
