import { app } from "electron";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

/**
 * Returns the absolute path to the bundled binaries directory.
 *
 * Both dev and packaged builds resolve to a `binaries/` directory owned
 * by the desktop app:
 * - Dev: `apps/desktop/binaries/` (`app.getAppPath()` is `apps/desktop/`).
 * - Packaged: `{resourcesPath}/binaries/`, populated by the Forge
 *   `extraResource: ['./binaries']` entry in `forge.config.ts`.
 *
 * The directory is expected to be populated out-of-band (CI artifact,
 * developer copy/symlink from shared fixtures, etc.). If it's missing,
 * `listBundledBinaryFiles` returns an empty map and callers treat that
 * as "no bundled defaults".
 */
export function getBundledBinariesPath(): string {
	if (app.isPackaged) {
		return path.join(process.resourcesPath, "binaries");
	}

	return path.resolve(app.getAppPath(), "binaries");
}

/**
 * Reads the bundled binaries directory and returns a map of filename to
 * absolute path. Returns an empty map if the directory is missing or
 * unreadable — callers should treat that as "no binaries bundled".
 *
 * Only regular files are included; subdirectories are skipped. The keys
 * are the filenames as they appear on disk (e.g. `ffmpeg.exe`,
 * `model_1.onnx`); callers are responsible for mapping schema-binary
 * keys to these filenames.
 */
export async function listBundledBinaryFiles(): Promise<Record<string, string>> {
	const directory = getBundledBinariesPath();

	let entries: Array<Dirent>;

	try {
		entries = await fs.readdir(directory, { withFileTypes: true });
	} catch {
		return {};
	}

	const map: Record<string, string> = {};

	for (const entry of entries) {
		if (!entry.isFile()) continue;

		map[entry.name] = path.join(directory, entry.name);
	}

	return map;
}
