interface TitleBarProps {
	readonly children?: React.ReactNode;
}

export const TitleBar: React.FC<TitleBarProps> = ({ children }) => (
		<div
			className="relative flex h-[45px] shrink-0 items-center border-b border-border bg-[var(--surface-panel-header)]"
			style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
		>
			{children && (
				<div className="self-stretch" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
					{children}
				</div>
			)}

			<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
				<span className="type-display text-sm">Engineering</span>
			</div>

			<div className="flex-1" />

			<div className="w-[138px]" />
		</div>
	);
