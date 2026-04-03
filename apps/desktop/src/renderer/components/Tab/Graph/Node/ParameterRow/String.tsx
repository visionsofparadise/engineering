export interface StringParameter {
	readonly kind: "string";
	readonly name: string;
	readonly value: string;
}

export function StringRow({
	param,
	dimmed,
	onParameterChange,
}: {
	readonly param: StringParameter;
	readonly dimmed?: boolean;
	readonly onParameterChange?: (name: string, value: unknown) => void;
}) {
	return (
		<div className={`flex flex-col gap-1 ${dimmed ? "opacity-40" : ""}`}>
			<span className={`font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] ${dimmed ? "text-chrome-text-dim" : "text-chrome-text-secondary"}`}>
				{param.name}
			</span>
			<input
				key={param.value}
				type="text"
				defaultValue={param.value}
				onBlur={onParameterChange ? (ev) => onParameterChange(param.name, ev.target.value) : undefined}
				onKeyDown={(ev) => { if (ev.key === "Enter") ev.currentTarget.blur(); }}
				className="w-full bg-chrome-base px-2 py-1.5 font-technical text-[length:var(--text-sm)] text-chrome-text outline-none"
			/>
		</div>
	);
}
