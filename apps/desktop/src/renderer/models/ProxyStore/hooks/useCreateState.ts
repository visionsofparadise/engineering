import { useMemo } from "react";
import { useSnapshot } from "valtio";
import { proxy as proxify, type Snapshot } from "valtio/vanilla";
import type { State } from "../../State";
import type { ProxyStore } from "../ProxyStore";

export function useCreateState<T extends State>(initial: Omit<T, "_key">, store: ProxyStore): Snapshot<T> {
	const proxy = useMemo(() => {
		const _key = Symbol();

		const proxy = proxify({ ...initial, _key });

		store.dangerouslySetProxy(_key, proxy);

		return proxy;
	}, [store]);

	return useSnapshot(proxy) as Snapshot<T>;
}
