import type { ChainDefinition, ChainModuleReference } from "@engineering/acm";
import { useCallback } from "react";
import type { AppContext } from "../../models/Context";
import { ChainManagerMenu } from "../Session/Chain/ChainManager/ChainManagerMenu";
import { ChainSlots } from "../Session/Chain/ChainSlots";
import { ScrollArea } from "../ui/scroll-area";

interface BatchChainProps {
	readonly context: AppContext;
	readonly disabled: boolean;
}

export const BatchChain: React.FC<BatchChainProps> = ({ context, disabled }) => {
	const { app, appStore, userDataPath } = context;
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
				<ChainSlots context={context} chain={chain} setChain={setChain} disabled={disabled} />
			</ScrollArea>
		</div>
	);
};
