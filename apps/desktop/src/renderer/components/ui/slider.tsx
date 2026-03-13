import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "../../utils/cn"

const Slider = React.forwardRef<
  React.ComponentRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root> & { ticks?: number }
>(({ className, ticks = 10, min = 0, max = 100, ...props }, ref) => {
  const tickMarks = Array.from({ length: ticks + 1 }, (_, tickIndex) => tickIndex / ticks)

  return (
    <div className="relative mt-3 pb-2.5">
      <SliderPrimitive.Root
        ref={ref}
        min={min}
        max={max}
        className={cn(
          "relative z-10 flex w-full touch-none select-none items-center py-1",
          className
        )}
        {...props}
      >
        <SliderPrimitive.Track className="surface-channel relative h-2 w-full grow overflow-hidden">
          <SliderPrimitive.Range className="surface-slider-range absolute h-full" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="relative block h-8 w-5 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50">
          {/* Side walls of the cap */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'var(--fader-thumb)',
              filter: 'brightness(0.85)',
              boxShadow: '0 4px 8px rgba(0,0,0,0.4), 0 2px 4px rgba(0,0,0,0.3), 0 1px 2px rgba(0,0,0,0.2)',
            }}
          />
          {/* Bottom face — facing away from viewer, in shadow */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 2,
              background: 'var(--fader-thumb)',
              filter: 'brightness(0.5)',
            }}
          />
          {/* Top face — slightly inset, lighter (closer to viewer) */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 4,
              right: 4,
              bottom: 2,
              background: 'var(--fader-thumb)',
              boxShadow: [
                'inset 0 1px 0 rgba(255,255,255,0.12)',
                'inset 0 -1px 0 rgba(0,0,0,0.1)',
                'inset 1px 0 0 rgba(255,255,255,0.06)',
                'inset -1px 0 0 rgba(0,0,0,0.08)',
              ].join(', '),
            }}
          >
            {/* Grip lines */}
            <div className="absolute inset-x-[2px] top-[8px] h-[2px]" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(255,255,255,0.12))' }} />
            <div className="absolute inset-x-[2px] top-[12px] h-[2px]" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(255,255,255,0.12))' }} />
            <div className="absolute inset-x-[2px] top-[16px] h-[2px]" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.35), rgba(255,255,255,0.12))' }} />
          </div>
        </SliderPrimitive.Thumb>
      </SliderPrimitive.Root>
      <div className="absolute bottom-0 left-2.5 right-2.5 h-2">
        {tickMarks.map((frac, tickIndex) => {
          const isMajor = tickIndex === 0 || tickIndex === ticks || tickIndex === Math.round(ticks / 2)
          return (
            <div
              key={tickIndex}
              className={cn(
                "absolute top-0 w-px bg-muted-foreground/25",
                isMajor ? "h-2" : "h-1"
              )}
              style={{ left: `${frac * 100}%` }}
            />
          )
        })}
      </div>
    </div>
  )
})
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
