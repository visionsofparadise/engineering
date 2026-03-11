import type { ChainDefinition } from "@engineering/acm";
import { Settings2 } from "lucide-react";
import { useCallback } from "react";
import { MODULE_REGISTRY } from "../../../../../shared/ipc/Audio/apply/utils/registry";
import { Button } from "../../../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/popover";
import { ParameterSwitch } from "./ParameterSwitch";
import { getShape, unwrapDefault } from "./utils/schema";

interface ParametersProps {
	readonly module: string;
	readonly index: number;
	readonly chain: ChainDefinition;
	readonly setChain: (updater: (chain: ChainDefinition) => ChainDefinition) => void;
	readonly disabled?: boolean;
}

export const Parameters: React.FC<ParametersProps> = ({ module, index, chain, setChain, disabled }) => {
	const moduleClass = MODULE_REGISTRY.get(module);
	const shape = moduleClass ? getShape(moduleClass.schema) : undefined;
	const entries = shape ? Object.entries(shape) : [];

	const options = chain.transforms[index]?.options;

	const commitKey = useCallback(
		(key: string, value: unknown) => {
			setChain((current) => ({
				...current,
				transforms: current.transforms.map((transform, position) =>
					position === index ? { ...transform, options: { ...transform.options, [key]: value } } : transform,
				),
			}));
		},
		[index, setChain],
	);

	if (entries.length === 0) return null;

	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="h-5 w-5 shrink-0"
				>
					<Settings2 className="h-3 w-3" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className="w-64 space-y-3 p-3"
				align="start"
				side="left"
			>
				{entries.map(([key, field]) => {
					const unwrapped = field._def ? unwrapDefault(field._def) : undefined;
					if (!unwrapped) return null;
					const label = unwrapped.label ?? field.description ?? key;
					const initialValue = options?.[key] ?? unwrapped.defaultValue;
					return (
						<ParameterSwitch
							key={key}
							fieldKey={key}
							def={unwrapped.def}
							label={label}
							initialValue={initialValue}
							onCommit={(next) => commitKey(key, next)}
							disabled={disabled}
						/>
					);
				})}
			</PopoverContent>
		</Popover>
	);
};
