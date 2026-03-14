import * as React from "react"
import { FolderOpen, X } from "lucide-react"

import { cn } from "../../utils/cn"

interface FileInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
 value?: string
 onValueChange?: (value: string) => void
 placeholder?: string
}

const FileInput = React.forwardRef<HTMLInputElement, FileInputProps>(
 ({ className, value, onValueChange, accept, placeholder = "No file selected", ...props }, _ref) => {
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
 <div className={cn("flex items-center gap-1", className)}>
 <div
 className="surface-control flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 px-3"
 onClick={handleClick}
 >
 <span className={cn(
"flex-1 truncate text-sm",
 value ? "text-foreground" : "text-muted-foreground"
 )}>
 {value ?? placeholder}
 </span>
 {value && (
 <button
 type="button"
 onClick={handleClear}
 className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
 >
 <X className="h-3.5 w-3.5" />
 </button>
 )}
 </div>
 <button
 type="button"
 onClick={handleClick}
 className="surface-control flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground transition-all hover:text-foreground active:translate-y-px"
 >
 <FolderOpen className="h-4 w-4" />
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
