import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;

export function DropdownMenuContent({
	className,
	sideOffset = 4,
	collisionPadding = 8,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				sideOffset={sideOffset}
				collisionPadding={collisionPadding}
				className={cn(
					"z-50 flex flex-col gap-2 bg-chrome-raised py-2 shadow-lg outline-none",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}

export function DropdownMenuItem({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
	return (
		<DropdownMenuPrimitive.Item
			className={cn(
				"mx-2 flex cursor-pointer items-center gap-2 py-1 text-left font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text outline-none data-[highlighted]:bg-interactive-hover data-[disabled]:cursor-default data-[disabled]:opacity-30",
				className,
			)}
			{...props}
		/>
	);
}

export function DropdownMenuLabel({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>) {
	return (
		<DropdownMenuPrimitive.Label
			className={cn(
				"mx-2 px-1 py-1 font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-muted",
				className,
			)}
			{...props}
		/>
	);
}

export function DropdownMenuSeparator({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
	return (
		<DropdownMenuPrimitive.Separator
			className={cn("mx-2 my-1 h-px bg-chrome-border-subtle", className)}
			{...props}
		/>
	);
}

export function DropdownMenuSubTrigger({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger>) {
	return (
		<DropdownMenuPrimitive.SubTrigger
			className={cn(
				"mx-2 flex cursor-pointer items-center gap-2 py-1 text-left font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] text-chrome-text outline-none data-[highlighted]:bg-interactive-hover data-[state=open]:bg-interactive-hover data-[disabled]:cursor-default data-[disabled]:opacity-30",
				className,
			)}
			{...props}
		/>
	);
}

export function DropdownMenuSubContent({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.SubContent
				className={cn(
					"z-50 flex flex-col gap-2 bg-chrome-raised py-2 shadow-lg outline-none",
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	);
}
