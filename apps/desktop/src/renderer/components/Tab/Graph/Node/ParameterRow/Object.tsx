import type { ObjectParameter } from "../utils/buildParameters";
import type { ParameterCallbacks } from "./ParameterField";
import { ParameterField } from "./ParameterField";

/** Always-expanded container for nested object parameters. No collapse toggle. */
export function ObjectRow({
	param,
	basePath,
	dimmed,
	callbacks,
}: {
	readonly param: ObjectParameter;
	readonly basePath: ReadonlyArray<string | number>;
	readonly dimmed?: boolean;
	readonly callbacks: ParameterCallbacks;
}) {
	const childPath = [...basePath, param.name];

	return (
		<div className="flex flex-col gap-2">
			<span className="font-technical text-[length:var(--text-xs)] uppercase tracking-[0.06em] text-chrome-text-dim">
				{param.name}
			</span>
			<div className="flex flex-col gap-3 border-l border-chrome-border-subtle pl-2">
				{param.children.map((child) => (
					<ParameterField
						key={child.name}
						param={child}
						basePath={childPath}
						dimmed={dimmed}
						callbacks={callbacks}
					/>
				))}
			</div>
		</div>
	);
}
