import { DropdownButton, IconButton, type MenuItem } from "@e9g/design-system";
import type { AppContext } from "../models/Context";

interface Props {
	readonly context: AppContext;
	readonly menuItems: ReadonlyArray<MenuItem>;
}

export function TitleBar({ context: _context, menuItems }: Props) {
	return (
		<div
			className="relative h-[45px] w-full shrink-0 bg-chrome-base pr-[138px]"
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			<div
				className="flex h-full items-center px-2"
				style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
			>
				<DropdownButton
					trigger={<IconButton icon="lucide:menu" label="Menu" size={16} />}
					items={menuItems}
					menuClassName="min-w-[36rem]"
				/>
			</div>

			<span
				className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 select-none font-display uppercase tracking-[0.06em] text-chrome-text text-[length:var(--text-2xl)]"
			>
				ENGINEERING
			</span>
		</div>
	);
}
