import type { AppContext } from "../models/Context";
import { ActiveTab } from "./ActiveTab";
import { Tabs } from "./Tabs";
import { Toolbar } from "./Toolbar";

interface LayoutProps {
	context: AppContext;
}

export const Layout: React.FC<LayoutProps> = ({ context }) => (
	<div className="flex h-screen flex-col">
		<Toolbar />
		<Tabs context={context} />
		<div className="flex flex-1 overflow-hidden">
			<ActiveTab context={context} />
		</div>
	</div>
);
