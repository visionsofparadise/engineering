import { resnapshot } from "../../../../models/ProxyStore/resnapshot";
import type { IdentifiedChain } from "../../../../models/Chain";
import { useCallback, type ReactNode } from "react";
import type { AppContext } from "../../../../models/Context";
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/popover";
import { ParameterSwitch } from "./ParameterSwitch";
import { getProperties } from "./utils/schema";

interface ParametersProps {
	readonly packageName: string;
	readonly module: string;
	readonly index: number;
	readonly context: AppContext;
	readonly chain: IdentifiedChain;
	readonly setChain: (updater: (chain: IdentifiedChain) => IdentifiedChain) => void;
	readonly disabled?: boolean;
	readonly children: ReactNode;
}

export const Parameters: React.FC<ParametersProps> = resnapshot(({ packageName, module, index, context, chain, setChain, disabled, children }) => {
	const app = context.app;
	const packageState = app.packages.find((ps) => ps.name === packageName);
	const mod = packageState?.modules.find((mi) => mi.moduleName === module);
	const properties = mod ? getProperties(mod.schema) : undefined;
	const entries = properties ? Object.entries(properties) : [];

	const parameters = chain.transforms[index]?.parameters;

	const commitKey = useCallback(
		(key: string, value: unknown) => {
			setChain((current) => ({
				...current,
				transforms: current.transforms.map((transform, position) =>
					position === index ? { ...transform, parameters: { ...transform.parameters, [key]: value } } : transform,
				),
			}));
		},
		[index, setChain],
	);

	if (entries.length === 0) return <>{children}</>;

	return (
		<Popover>
			<PopoverTrigger asChild>
				{children}
			</PopoverTrigger>
			<PopoverContent
				className="w-72 space-y-5 p-3"
				align="center"
				side="left"
				sideOffset={32}
			>
				{entries.map(([key, property]) => {
					const label = property.description ?? key;
					const initialValue = parameters?.[key] ?? property.default;

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
});
