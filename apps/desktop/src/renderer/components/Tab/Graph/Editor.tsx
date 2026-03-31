import { ReactFlowProvider } from "@xyflow/react";
import type { GraphContext } from "../../../models/Context";
import { GraphCanvas } from "./Canvas";

interface Props {
	readonly context: GraphContext;
}

export function GraphEditor({ context }: Props) {
	return (
		<ReactFlowProvider>
			<GraphCanvas context={context} />
		</ReactFlowProvider>
	);
}
