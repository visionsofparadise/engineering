import type { ChainDefinition, ChainModuleReference } from "@engineering/acm";
import { useCallback } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { ProxyStore } from "../../models/ProxyStore/ProxyStore";
import type { AppState } from "../../models/State/App";
import { ChainManagerMenu } from "../Session/Chain/ChainManager/ChainManagerMenu";
import { ChainSlots } from "../Session/Chain/ChainSlots";
import { ScrollArea } from "../ui/scroll-area";

interface BatchChainProps {
	readonly app: Snapshot<AppState>;
	readonly appStore: ProxyStore;
	readonly disabled: boolean;
	readonly userDataPath: string;
}

export const BatchChain: React.FC<BatchChainProps> = ({ app, appStore, disabled, userDataPath }) => {
	const chain: ChainDefinition = { transforms: app.batch.transforms as Array<ChainModuleReference> };

	const setChain = useCallback(
		(updater: (c: ChainDefinition) => ChainDefinition) => {
			const updated = updater(chain);
			appStore.mutate(app, (proxy) => {
				proxy.batch.transforms = updated.transforms as Array<ChainModuleReference>;
			});
		},
		[app, appStore, chain],
	);

	const handleChainChange = useCallback(
		(updated: ChainDefinition) => {
			appStore.mutate(app, (proxy) => {
				proxy.batch.transforms = updated.transforms as Array<ChainModuleReference>;
			});
		},
		[app, appStore],
	);

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between border-b border-border px-3 py-2">
				<span className="text-xs font-medium text-muted-foreground">Chain</span>
				<ChainManagerMenu
					chain={chain}
					onChainChange={handleChainChange}
					userDataPath={userDataPath}
				/>
			</div>
			<ScrollArea className="flex-1">
				<ChainSlots app={app} chain={chain} setChain={setChain} disabled={disabled} />
			</ScrollArea>
		</div>
	);
};
