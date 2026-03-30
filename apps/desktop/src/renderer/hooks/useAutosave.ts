import { useEffect } from "react";
import { subscribe, type Snapshot } from "valtio/vanilla";
import type { Main } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState } from "../models/State/App";

const DEBOUNCE_MS = 500;

export function useAutosave(app: Snapshot<AppState>, store: ProxyStore, main: Main, userDataPath: string): void {
	useEffect(() => {
		const proxy = store.dangerouslyGetProxy<AppState>(app._key);

		if (!proxy) return;

		let timer: ReturnType<typeof setTimeout> | null = null;
		let pendingData: string | null = null;

		function flush(): void {
			if (pendingData !== null) {
				const data = pendingData;

				pendingData = null;
				void main.writeFile(`${userDataPath}/state.json`, data);
			}
		}

		const unsubscribe = subscribe(proxy, () => {
			pendingData = JSON.stringify(proxy, null, 2);

			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(() => {
				timer = null;
				flush();
			}, DEBOUNCE_MS);
		});

		const onBeforeUnload = (): void => {
			flush();
		};

		window.addEventListener("beforeunload", onBeforeUnload);

		return () => {
			unsubscribe();
			window.removeEventListener("beforeunload", onBeforeUnload);

			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}

			flush();
		};
	}, [app._key, store, main, userDataPath]);
}
