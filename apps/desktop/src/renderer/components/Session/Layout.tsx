import type { SessionContext } from "../../models/Context";
import { GraphEditor } from "./Graph";
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
			<div className="flex w-[480px] shrink-0 flex-col border-l border-border">
				<GraphEditor context={context} />
			</div>
		</div>
		<Transport context={context} />
	</div>
);
