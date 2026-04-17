import { TerrainShader } from "@e9g/design-system";
import type { AppContext } from "../../models/Context";
import { EngineeringIcon } from "../EngineeringIcon";

interface Props {
	readonly context: AppContext;
}

export function HomeScreen({ context }: Props) {
	return (
		<div className="flex-1 relative overflow-hidden">
			<TerrainShader colormap={context.app.theme} className="absolute inset-0" />
			<div className="absolute inset-0 flex items-center justify-center px-6">
				<div className="flex flex-col items-center gap-4">
					<EngineeringIcon
						theme={context.app.theme}
						className="h-24 w-24 drop-shadow-[0_24px_48px_rgba(0,0,0,0.35)]"
						title="Engineering"
					/>
					<div className="flex flex-col items-center gap-1">
						<h1 className="font-body text-4xl tracking-[-0.04em] text-chrome-text">
							Engineering
						</h1>
						<p className="font-technical text-chrome-text-dim text-xs uppercase tracking-[0.14em]">
							Audio Processing Workstation
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}
