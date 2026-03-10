import { useEffect } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { WindowState } from "../../shared/utilities/emitToRenderer";
import type { MainWithEvents } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState } from "../models/State/App";

export function useWindowState(app: Snapshot<AppState>, appStore: ProxyStore, main: MainWithEvents): void {
	useEffect(() => {
		const saved = app.windowState;

		if (!saved) return;

		void (async () => {
			const displays = await main.getAllDisplays();

			const isOnDisplay = displays.some((display) =>
				saved.x >= display.x && saved.y >= display.y && saved.x + saved.width <= display.x + display.width && saved.y + saved.height <= display.y + display.height,
			);

			if (isOnDisplay) {
				await main.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });
			}
		})();
	}, []);

	useEffect(() => {
		const handler = (windowState: WindowState) => {
			appStore.mutate(app, (proxy) => {
				proxy.windowState = windowState;
			});
		};

		main.events.on("windowBoundsChanged", handler);

		return () => {
			main.events.off("windowBoundsChanged", handler);
		};
	}, [main, app, appStore]);
}
