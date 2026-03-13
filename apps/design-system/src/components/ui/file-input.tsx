import * as React from "react"
import { FolderOpen, X } from "lucide-react"

import { cn } from "../../utils/cn"

interface FileInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
 value?: string
 onValueChange?: (value: string) => void
 placeholder?: string
}

const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
 ({ className, value, onValueChange, accept, placeholder = "No file loaded", ...props }, _ref) => {
 const internalRef = React.useRef<HTMLInputElement>(null)

 const handleClick = () => {
 internalRef.current?.click()
 }

 const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
 const file = event.target.files?.[0]
 if (file) {
 onValueChange?.(file.name)
 }
 }

 const handleClear = (event: React.MouseEvent) => {
 event.stopPropagation()
 onValueChange?.("")
 if (internalRef.current) {
 internalRef.current.value = ""
 }
 }

 return (
 <div className={cn("flex items-center gap-2", className)}>
 <div
 className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5"
 style={{
 background: 'linear-gradient(170deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 25%, transparent 50%, transparent 75%, rgba(255,255,255,0.03) 100%) #000',
 boxShadow: [
 'inset 0 1px 0 rgba(255,255,255,0.18)',
 'inset 0 -1px 0 rgba(255,255,255,0.04)',
 'inset 1px 0 0 rgba(255,255,255,0.08)',
 'inset -1px 0 0 rgba(255,255,255,0.03)',
 'inset 0 2px 8px rgba(0,0,0,0.8)',
 '0 1px 0 rgba(255,255,255,0.06)',
 ].join(', '),
 border: '1px solid rgba(255,255,255,0.1)',
 }}
 >
 <span className={cn(
"flex-1 truncate font-mono text-[0.625rem] tabular-nums",
 value ? "text-primary" : "text-neutral-600"
 )}>
 {value || placeholder}
 </span>
 {value && (
 <button
 type="button"
 onClick={handleClear}
 className="shrink-0 text-neutral-500 transition-colors hover:text-neutral-300"
 >
 <X className="h-3 w-3" />
 </button>
 )}
 </div>
 <button
 type="button"
 onClick={handleClick}
 className="shrink-0 border border-border bg-muted p-1.5 text-muted-foreground transition-all hover:text-foreground active:translate-y-px"
 style={{
 boxShadow: [
 'inset 0 2px 3px -1px rgba(255,255,255,0.15)',
 'inset 0 -2px 3px -1px rgba(0,0,0,0.25)',
 '0 1px 2px rgba(0,0,0,0.15)',
 ].join(', '),
 }}
 >
 <FolderOpen className="h-3.5 w-3.5" />
 </button>
 <input
 ref={internalRef}
 type="file"
 accept={accept}
 className="sr-only"
 onChange={handleChange}
 {...props}
 />
 </div>
 )
 }
)
FileInput.displayName = "FileInput"

export { FileInput }
