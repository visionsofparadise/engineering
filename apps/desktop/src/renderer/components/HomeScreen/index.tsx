import { TerrainShader } from "@e9g/design-system";
import type { AppContext } from "../../models/Context";

export function HomeScreen({ context }: { readonly context: AppContext }) {
	return (
		<div className="flex-1 relative overflow-hidden">
			<TerrainShader colormap={context.app.theme} className="absolute inset-0" />
		</div>
	);
}
