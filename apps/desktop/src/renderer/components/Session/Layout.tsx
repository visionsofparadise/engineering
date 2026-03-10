import { Group, Panel, Separator } from "react-resizable-panels";
import type { SessionContext } from "../../models/Context";
import { ChainPanel } from "./Chain";
import { History } from "./History";
import { Transport } from "./Transport";
import { Workspace } from "./Workspace";

interface SessionLayoutProps {
	readonly context: SessionContext;
}

export const SessionLayout: React.FC<SessionLayoutProps> = ({ context }) => (
	<div className="flex flex-1 flex-col overflow-hidden">
		<div className="flex flex-1 overflow-hidden">
			<Group
				orientation="horizontal"
				className="flex-1"
			>
				<Panel
					defaultSize={75}
					minSize={40}
				>
					<Workspace context={context} />
				</Panel>
				<Separator className="w-px bg-border hover:bg-ring transition-colors" />
				<Panel
					defaultSize={25}
					minSize={15}
				>
					<Group orientation="vertical">
						<Panel
							defaultSize={60}
							minSize={20}
						>
							<ChainPanel context={context} />
						</Panel>
						<Separator className="h-px bg-border hover:bg-ring transition-colors" />
						<Panel
							defaultSize={40}
							minSize={15}
						>
							<History context={context} />
						</Panel>
					</Group>
				</Panel>
			</Group>
		</div>
		<Transport />
	</div>
);
