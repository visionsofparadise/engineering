import { useCallback } from "react";
import { X } from "lucide-react";
import { Switch } from "../../ui/switch";
import { ParameterSwitch } from "../Chain/Parameters/ParameterSwitch";
import { getProperties } from "../Chain/Parameters/utils/schema";
import type { SessionContext } from "../../../models/Context";

interface NodeParametersProps {
	readonly nodeId: string;
	readonly context: SessionContext;
	readonly onClose: () => void;
}

export const NodeParameters: React.FC<NodeParametersProps> = ({ nodeId, context, onClose }) => {
	const { graph, app } = context;
	const { graphDefinition } = graph;

	const node = graphDefinition?.nodes.find((n) => n.id === nodeId);

	const packageState = node ? app.packages.find((ps) => ps.name === node.packageName) : undefined;
	const mod = packageState?.modules.find((mi) => mi.moduleName === node?.nodeName);
	const properties = mod ? getProperties(mod.schema) : undefined;
	const entries = properties ? Object.entries(properties) : [];

	const commitKey = useCallback(
		(key: string, value: unknown) => {
			if (!node) return;
			graph.updateNodeParameters(nodeId, { ...node.parameters, [key]: value });
		},
		[node, nodeId, graph],
	);

	if (!node) return null;

	return (
		<div className="absolute right-4 top-14 z-20 w-72 rounded-lg border border-border bg-card shadow-lg">
			<div className="flex items-center justify-between border-b border-border px-3 py-2">
				<span className="text-sm font-medium text-card-foreground">{node.nodeName}</span>
				<button
					className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
					onClick={onClose}
				>
					<X className="h-4 w-4" />
				</button>
			</div>

			<div className="space-y-4 p-3">
				<div className="flex items-center justify-between">
					<span className="text-sm text-muted-foreground">Bypass</span>
					<Switch
						checked={node.options?.bypass ?? false}
						onCheckedChange={() => graph.toggleBypass(nodeId)}
					/>
				</div>

				{entries.map(([key, property]) => {
					const label = property.description ?? key;
					const initialValue = node.parameters?.[key] ?? property.default;

					return (
						<ParameterSwitch
							key={key}
							fieldKey={key}
							property={property}
							label={label}
							initialValue={initialValue}
							onCommit={(next) => commitKey(key, next)}
							context={context}
						/>
					);
				})}
			</div>
		</div>
	);
};
