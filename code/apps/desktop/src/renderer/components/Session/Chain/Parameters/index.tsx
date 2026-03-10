import { Settings2 } from "lucide-react";
import { MODULE_REGISTRY } from "../../../../../shared/ipc/Audio/applyChain/utils";
import { useSaveChain } from "../../../../hooks/useChain";
import type { SessionContext } from "../../../../models/Context";
import { Button } from "../../../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/popover";
import { ParameterSwitch } from "./ParameterSwitch";
import { getShape, unwrapDefault } from "./utils/schema";

interface ParametersProps {
	readonly module: string;
	readonly index: number;
	readonly context: SessionContext;
	readonly disabled?: boolean;
}

export const Parameters: React.FC<ParametersProps> = ({ module, index, context, disabled }) => {
	const moduleClass = MODULE_REGISTRY.get(module);
	const shape = moduleClass ? getShape(moduleClass.schema) : undefined;
	const entries = shape ? Object.entries(shape) : [];
	const saveChain = useSaveChain(context.sessionPath);

	const options = context.chain.transforms[index]?.options;

	const commitKey = (key: string, value: unknown) => {
		const currentOptions = { ...context.chain.transforms[index]?.options, [key]: value };
		const updated = context.chain.transforms.map((transform, position) => (position === index ? { ...transform, options: currentOptions } : transform));
		saveChain.mutate({ ...context.chain, transforms: updated });
	};

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
