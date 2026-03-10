import { useEffect, useMemo, useRef } from "react";
import { subscribe, type Snapshot } from "valtio/vanilla";
import type { MainWithEvents } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState } from "../models/State/App";

export function useAutosave(app: Snapshot<AppState>, store: ProxyStore, main: MainWithEvents): void {
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const proxy = useMemo(() => store.dangerouslyGetProxy<AppState>(app._key), [store, app._key]);

	useEffect(() => {
		if (!proxy) return;

		const unsubscribe = subscribe(proxy, () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);

			debounceRef.current = setTimeout(() => {
				void (async () => {
					try {
						const userDataPath = await main.getUserDataPath();
						const statePath = `${userDataPath}/state.json`;
						const json = JSON.stringify(proxy, null, 2);

						await main.writeFile(statePath, json);
					} catch {
						return;
					}
				})();
			}, 500);
		});

		return () => {
			unsubscribe();

			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [proxy, main, app]);
}
