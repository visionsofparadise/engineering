import { useState } from "react";
import type { AppContext } from "../models/Context";
import { ActiveTab } from "./ActiveTab";
import { BinaryManager } from "./BinaryManager/BinaryManager";
import { ModuleManager } from "./ModuleManager/ModuleManager";
import { Tabs } from "./Tabs";
import { Toolbar } from "./Toolbar";

interface LayoutProps {
	context: AppContext;
}

export const Layout: React.FC<LayoutProps> = ({ context }) => {
	const [moduleManagerOpen, setModuleManagerOpen] = useState(false);
	const [binaryManagerOpen, setBinaryManagerOpen] = useState(false);

	return (
		<div className="flex h-screen flex-col">
			<Toolbar context={context} onManagePackages={() => setModuleManagerOpen(true)} onManageBinaries={() => setBinaryManagerOpen(true)} />
			<Tabs context={context} />
			<div className="flex flex-1 overflow-hidden">
				<ActiveTab context={context} />
			</div>
			<ModuleManager context={context} open={moduleManagerOpen} onOpenChange={setModuleManagerOpen} />
			<BinaryManager context={context} open={binaryManagerOpen} onOpenChange={setBinaryManagerOpen} />
		</div>
	);
};
