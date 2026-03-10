import { Group, Panel, Separator } from "react-resizable-panels";
import { ChainSlots } from "./ChainSlots";
import { History } from "./History";
import { Transport } from "./Transport";
import { Workspace } from "./Workspace";

export const SessionLayout: React.FC = () => (
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
					<Workspace />
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
							<ChainSlots />
						</Panel>
						<Separator className="h-px bg-border hover:bg-ring transition-colors" />
						<Panel
							defaultSize={40}
							minSize={15}
						>
							<History />
						</Panel>
					</Group>
				</Panel>
			</Group>
		</div>
		<Transport />
	</div>
);
