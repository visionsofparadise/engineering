import { useEffect } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { Main } from "../models/Main";
import type { ProxyStore } from "../models/ProxyStore/ProxyStore";
import type { AppState } from "../models/State/App";

/**
 * Maps each schema `binary` key to the filename it has in the desktop
 * app's `binaries/` directory. Keys must match the `binary` property on
 * Zod schemas in `@e9g/buffered-audio-nodes` exactly — grep
 * `packages/buffered-audio-nodes/src` for `binary:` to confirm.
 *
 * Keys present in schemas but without a matching fixture file (e.g. the
 * ONNX Runtime shared library, which is loaded by the addon dynamically
 * and is not declared in any schema) are intentionally omitted.
 */
const BINARY_FILENAMES: Readonly<Record<string, string>> = {
	ffmpeg: "ffmpeg.exe",
	ffprobe: "ffprobe.exe",
	"dtln-model_1": "model_1.onnx",
	"dtln-model_2": "model_2.onnx",
	htdemucs: "htdemucs.onnx",
	Kim_Vocal_2: "Kim_Vocal_2.onnx",
	"onnx-addon": "onnx_addon.node",
	"vkfft-addon": "vkfft_addon.node",
	"fftw-addon": "fftw_addon.node",
};

export { BINARY_FILENAMES };

/**
 * On mount, fetch the bundled-binary filename→path map via IPC and
 * populate `AppState.binaries` for each schema key that is currently
 * unset. Never overwrites a user-set path.
 *
 * Runs once per app boot (deps are stable for the hook's lifetime —
 * `app._key` survives the whole window).
 */
export function useBinaryDefaults(app: Snapshot<AppState>, appStore: ProxyStore, main: Main): void {
	useEffect(() => {
		let cancelled = false;

		void main.listBundledBinaries().then((bundled) => {
			if (cancelled) return;

			const updates: Array<[string, string]> = [];

			for (const [key, filename] of Object.entries(BINARY_FILENAMES)) {
				const existing = (app.binaries as Readonly<Record<string, string>>)[key];

				if (existing !== undefined && existing !== "") continue;

				const bundledPath = bundled[filename];

				if (bundledPath === undefined) continue;

				updates.push([key, bundledPath]);
			}

			if (updates.length === 0) return;

			appStore.mutate(app, (proxy) => {
				for (const [key, bundledPath] of updates) {
					if (proxy.binaries[key] !== undefined && proxy.binaries[key] !== "") continue;

					proxy.binaries[key] = bundledPath;
				}
			});
		});

		return () => {
			cancelled = true;
		};
	}, [app, appStore, main]);
}
