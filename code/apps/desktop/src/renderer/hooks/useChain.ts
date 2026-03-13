import type { ChainDefinition } from "audio-chain-module";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useChain(sessionPath: string): ChainDefinition | undefined {
	const query = useQuery({
		queryKey: ["chain", sessionPath],
		queryFn: async () => {
			const content = await window.main.readFile(`${sessionPath}/chain.json`);
			return window.main.validateChain(JSON.parse(content));
		},
	});

	return query.data;
}

export function useSaveChain(sessionPath: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (chainDefinition: ChainDefinition) => {
			await window.main.writeFile(`${sessionPath}/chain.json`, JSON.stringify(chainDefinition, undefined, 2));
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["chain", sessionPath] });
		},
	});
}
