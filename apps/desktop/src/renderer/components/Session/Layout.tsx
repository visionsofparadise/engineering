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
	<div className="flex h-full flex-1 flex-col overflow-hidden">
		<div className="flex min-w-0 flex-1 overflow-hidden">
			<div className="min-w-0 flex-1">
				<Workspace context={context} />
			</div>
			<div className="flex w-72 shrink-0 flex-col border-l border-border">
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
			</div>
		</div>
		<Transport context={context} />
	</div>
);
