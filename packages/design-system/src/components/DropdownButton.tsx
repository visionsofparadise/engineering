import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Icon } from "@iconify/react";
import type { ReactNode } from "react";
import { cn } from "../cn";

export type MenuItem =
	| {
		readonly kind: "action";
		readonly label: string;
		readonly icon?: string;
		readonly shortcut?: string;
		readonly color?: string;
		readonly disabled?: boolean;
		readonly onClick?: () => void;
	}
	| {
		readonly kind: "separator";
	};

export interface DropdownButtonProps {
	readonly trigger: ReactNode;
	readonly items: ReadonlyArray<MenuItem>;
	readonly align?: "left" | "right";
}

export function DropdownButton({ trigger, items, align = "left" }: DropdownButtonProps) {
	return (
		<DropdownMenuPrimitive.Root>
			<DropdownMenuPrimitive.Trigger asChild>{trigger}</DropdownMenuPrimitive.Trigger>
			<DropdownMenuPrimitive.Portal>
				<DropdownMenuPrimitive.Content
					align={align === "right" ? "end" : "start"}
					sideOffset={4}
					collisionPadding={8}
					className="z-50 flex flex-col gap-2 bg-chrome-raised py-2 shadow-lg outline-none"
				>
					{items.map((item, index) => {
						if (item.kind === "separator") {
							return (
								<DropdownMenuPrimitive.Separator
									key={`separator-${String(index)}`}
									className="mx-2 my-1 h-px bg-chrome-border-subtle"
								/>
							);
						}

						return (
							<DropdownMenuPrimitive.Item
								key={`${item.label}-${String(index)}`}
								disabled={item.disabled}
								onSelect={item.onClick ? () => item.onClick?.() : undefined}
								className={cn(
									"mx-2 flex cursor-pointer items-center gap-2 py-1 text-left font-technical text-[length:var(--text-sm)] uppercase tracking-[0.06em] outline-none data-[highlighted]:bg-interactive-hover data-[disabled]:cursor-default data-[disabled]:opacity-30",
									item.color ?? "text-chrome-text",
								)}
							>
								{item.icon && (
									<Icon icon={item.icon} width={14} height={14} aria-hidden="true" />
								)}
								<span className="flex-1">{item.label}</span>
								{item.shortcut && (
									<span className="ml-4 font-technical text-[length:var(--text-xs)] tracking-[0.06em] text-chrome-text-dim">
										{item.shortcut}
									</span>
								)}
							</DropdownMenuPrimitive.Item>
						);
					})}
				</DropdownMenuPrimitive.Content>
			</DropdownMenuPrimitive.Portal>
		</DropdownMenuPrimitive.Root>
	);
}
