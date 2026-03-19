import type { ChainDefinition, ChainModuleReference } from "buffered-audio-nodes";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

export interface IdentifiedTransform extends ChainModuleReference {
	readonly id: string;
}

export interface IdentifiedChain {
	readonly label?: string;
	readonly transforms: Array<IdentifiedTransform>;
}

function hydrate(chain: ChainDefinition): IdentifiedChain {
	return {
		...chain,
		transforms: chain.transforms.map((transform) => ({
			...transform,
			id: crypto.randomUUID(),
		})),
	};
}

function dehydrate(chain: IdentifiedChain): ChainDefinition {
	return {
		...chain,
		transforms: chain.transforms.map(({ id: _, ...rest }) => rest),
	};
}

export function useChain(sessionPath: string) {
	const query = useQuery({
		queryKey: ["chain", sessionPath],
		queryFn: async () => {
			const content = await window.main.readFile(`${sessionPath}/chain.json`);
			return hydrate(await window.main.validateChain(JSON.parse(content)));
		},
		staleTime: Infinity,
	});

	const [chain, setChain] = useState<IdentifiedChain | undefined>(query.data);

	useEffect(() => {
		if (query.data) setChain(query.data);
	}, [query.data]);

	const save = useCallback(
		(updated: IdentifiedChain) => {
			setChain(updated);
			void window.main.writeFile(`${sessionPath}/chain.json`, JSON.stringify(dehydrate(updated), undefined, 2));
		},
		[sessionPath],
	);

	return { chain, save };
}
