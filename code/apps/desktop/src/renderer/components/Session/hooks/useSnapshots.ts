import { useQuery } from "@tanstack/react-query";
import type { SessionContext } from "../../../models/Context";

export function useSnapshots(context: SessionContext): ReadonlyArray<string> {
	const { sessionPath } = context;

	const query = useQuery({
		queryKey: ["snapshots", sessionPath],
		queryFn: async () => {
			const entries = await window.main.readDirectory(sessionPath);

			return entries
				.filter((entry) => entry !== "chain.json")
				.sort();
		},
	});

	return query.data ?? [];
}
