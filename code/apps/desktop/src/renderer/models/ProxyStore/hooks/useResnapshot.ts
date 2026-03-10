import { type Snapshot, useSnapshot } from "valtio";
import type { State } from "../../State";
import type { ProxyStore } from "../ProxyStore";

export function useResnapshot<T extends State>(state: T, store: ProxyStore): Snapshot<T> {
	const _proxy = store.dangerouslyGetProxy<T>(state._key);

	if (!_proxy) throw new Error("useResnapshot: proxy not found for key");

	return useSnapshot(_proxy);
}
