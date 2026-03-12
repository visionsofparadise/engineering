import type { ChainDefinition } from "@engineering/acm";
import { Settings2 } from "lucide-react";
import { useCallback } from "react";
import type { AppContext } from "../../../../models/Context";
import { Button } from "../../../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/popover";
import { ParameterSwitch } from "./ParameterSwitch";
import { getProperties } from "./utils/schema";

interface ParametersProps {
	readonly packageName: string;
	readonly module: string;
	readonly index: number;
	readonly context: AppContext;
	readonly chain: ChainDefinition;
	readonly setChain: (updater: (chain: ChainDefinition) => ChainDefinition) => void;
	readonly disabled?: boolean;
}

export const Parameters: React.FC<ParametersProps> = ({ packageName, module, index, context, chain, setChain, disabled }) => {
	const app = context.app;
	const packageState = app.packages.find((ps) => ps.directory === packageName);
	const mod = packageState?.modules.find((mi) => mi.moduleName === module);
	const properties = mod ? getProperties(mod.schema) : undefined;
	const entries = properties ? Object.entries(properties) : [];

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
				{entries.map(([key, property]) => {
					const label = property.description ?? key;
					const initialValue = options?.[key] ?? property.default;
					return (
						<ParameterSwitch
							key={key}
							fieldKey={key}
							property={property}
							label={label}
							initialValue={initialValue}
							onCommit={(next) => commitKey(key, next)}
							context={context}
							disabled={disabled}
						/>
					);
				})}
			</PopoverContent>
		</Popover>
	);
};
