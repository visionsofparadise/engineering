import { useEffect } from "react";
import type { IpcRendererEvent } from "electron";
import type { Snapshot } from "valtio/vanilla";
import type { Main } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState, WindowBounds } from "../models/State/App";

export function useWindowState(app: Snapshot<AppState>, appStore: ProxyStore, main: Main): void {
	useEffect(() => {
		// Restore saved window bounds on mount
		if (app.windowBounds) {
			const bounds = app.windowBounds;

			void main.getAllDisplays().then((displays) => {
				const isVisible = displays.some(
					(display) =>
						bounds.x < display.x + display.width &&
						bounds.x + bounds.width > display.x &&
						bounds.y < display.y + display.height &&
						bounds.y + bounds.height > display.y,
				);

				if (isVisible) {
					void main.setBounds(bounds);
				}
			});
		}

		// Subscribe to window bounds changes from main process
		const listener = (_event: IpcRendererEvent, windowBounds: WindowBounds): void => {
			appStore.mutate(app, (proxy) => {
				proxy.windowBounds = windowBounds;
			});
		};

		main.events.on("windowBoundsChanged", listener);

		return () => {
			main.events.removeListener("windowBoundsChanged", listener);
		};
	}, [app._key, appStore, main]);
}
