import { useEffect, useMemo, useRef } from "react";
import { subscribe, type Snapshot } from "valtio/vanilla";
import type { MainWithEvents } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState } from "../models/State/App";

export function useAutosave(app: Snapshot<AppState>, store: ProxyStore, main: MainWithEvents, userDataPath: string | undefined): void {
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const proxy = useMemo(() => store.dangerouslyGetProxy<AppState>(app._key), [store, app._key]);

	useEffect(() => {
		if (!proxy) return;

		if (!userDataPath) return;

		const statePath = `${userDataPath}/state.json`;

		const unsubscribe = subscribe(proxy, () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);

			debounceRef.current = setTimeout(() => {
				void (async () => {
					try {
						const json = JSON.stringify(proxy, null, 2);

						await main.writeFile(statePath, json);
					} catch {
						return;
					}
				})();
			}, 500);
		});

		const handleBeforeUnload = () => {
			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;
				const json = JSON.stringify(proxy, null, 2);
				void main.writeFile(statePath, json).catch(() => {});
			}
		};

		window.addEventListener("beforeunload", handleBeforeUnload);

		return () => {
			unsubscribe();
			window.removeEventListener("beforeunload", handleBeforeUnload);

			if (debounceRef.current) {
				clearTimeout(debounceRef.current);
				debounceRef.current = null;

				// Flush pending save
				const json = JSON.stringify(proxy, null, 2);
				void main.writeFile(statePath, json).catch(() => {});
			}
		};
	}, [proxy, main, app, userDataPath]);
}
