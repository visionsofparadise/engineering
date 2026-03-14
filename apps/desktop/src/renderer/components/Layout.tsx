import { useState } from "react";
import type { AppContext } from "../models/Context";
import { ActiveTab } from "./ActiveTab";
import { BinaryManager } from "./BinaryManager/BinaryManager";
import { FileDropZone } from "./FileDropZone";
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
		<FileDropZone context={context}>
			<div className="flex h-full flex-col surface-panel">
				<Toolbar context={context} onManagePackages={() => setModuleManagerOpen(true)} onManageBinaries={() => setBinaryManagerOpen(true)} />
				<Tabs context={context} />
				<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
					<div className="flex h-full flex-1 flex-col">
						<ActiveTab context={context} />
					</div>
				</div>
				<ModuleManager context={context} open={moduleManagerOpen} onOpenChange={setModuleManagerOpen} />
				<BinaryManager context={context} open={binaryManagerOpen} onOpenChange={setBinaryManagerOpen} />
			</div>
		</FileDropZone>
	);
};
