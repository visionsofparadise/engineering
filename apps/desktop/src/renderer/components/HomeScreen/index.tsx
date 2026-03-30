import { TerrainShader } from "@e9g/design-system";
import type { AppContext } from "../../models/Context";

interface Props {
	readonly context: AppContext;
}

export function HomeScreen({ context }: Props) {
	return (
		<div className="flex-1 relative overflow-hidden">
			<TerrainShader colormap={context.app.theme} className="absolute inset-0" />
		</div>
	);
}
