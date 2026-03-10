import { useQuery } from "@tanstack/react-query";
import { listChains } from "./chains";

export function useChains(userDataPath: string) {
	return useQuery({
		queryKey: ["chains"],
		queryFn: () => listChains(userDataPath),
	});
}
