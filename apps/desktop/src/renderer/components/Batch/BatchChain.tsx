import { resnapshot } from "../../models/ProxyStore/resnapshot";
import type { ChainModuleReference } from "audio-chain-module";
import { useCallback, useMemo } from "react";
import type { IdentifiedChain } from "../../hooks/useChain";
import type { AppContext } from "../../models/Context";
import { ChainSlots } from "../Session/Chain/ChainSlots";

interface BatchChainProps {
	readonly context: AppContext;
	readonly disabled: boolean;
}

export const BatchChain: React.FC<BatchChainProps> = resnapshot(({ context, disabled }) => {
	const { app, appStore } = context;

	const chain: IdentifiedChain = useMemo(
		() => ({
			transforms: (app.batch.transforms as Array<ChainModuleReference>).map((transform) => ({ ...transform, id: crypto.randomUUID() })),
		}),
		[app.batch.transforms],
	);

	const setChain = useCallback(
		(updater: (c: IdentifiedChain) => IdentifiedChain) => {
			const updated = updater(chain);
			appStore.mutate(app, (proxy) => {
				proxy.batch.transforms = updated.transforms.map(({ id: _, ...rest }) => rest) as Array<ChainModuleReference>;
			});
		},
		[app, appStore, chain],
	);

	return (
		<div className="flex h-full flex-col items-center justify-center px-3">
			<ChainSlots context={context} chain={chain} setChain={setChain} disabled={disabled} />
		</div>
	);
});
