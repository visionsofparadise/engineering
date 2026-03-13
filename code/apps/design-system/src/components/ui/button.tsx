import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "../../utils/cn"

const buttonVariants = cva(
"inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
 {
 variants: {
 variant: {
 default:
"surface-primary text-foreground active:translate-y-px active:shadow-[var(--shadow-pressed)]",
 destructive:
"bg-destructive text-destructive-foreground border border-destructive/40 shadow-[var(--shadow-raised)] hover:shadow-[var(--shadow-raised-hover)] active:translate-y-px active:shadow-[var(--shadow-pressed)]",
 outline:
"border border-input bg-background text-foreground shadow-[var(--shadow-raised)] hover:bg-accent hover:text-accent-foreground hover:shadow-[var(--shadow-raised-hover)] active:translate-y-px active:shadow-[var(--shadow-pressed)]",
 secondary:
"surface-control text-secondary-foreground active:translate-y-px active:shadow-[var(--shadow-pressed)]",
 ghost: "text-foreground hover:bg-accent hover:text-accent-foreground active:translate-y-px active:shadow-[var(--shadow-pressed)]",
 link: "text-primary underline-offset-4 hover:underline",
 },
 size: {
 default: "h-10 px-4 py-2",
 sm: "h-9 px-3",
 lg: "h-11 px-8",
 icon: "h-10 w-10",
 },
 },
 defaultVariants: {
 variant: "default",
 size: "default",
 },
 }
)

export interface ButtonProps
 extends React.ButtonHTMLAttributes<HTMLButtonElement>,
 VariantProps<typeof buttonVariants> {
 asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
 ({ className, variant, size, asChild = false, ...props }, ref) => {
 const Comp = asChild ? Slot : "button"
 return (
 <Comp
 className={cn(buttonVariants({ variant, size, className }))}
 ref={ref}
 {...props}
 />
 )
 }
)
Button.displayName = "Button"

export { Button, buttonVariants }
