import { app } from "electron";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import { z } from "zod";

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

const bundledBinariesManifestSchema = z.object({
	target: z.string(),
	binaries: z.record(z.string(), z.string()),
});

/**
 * Reads `<bundledBinariesPath>/manifest.json` (written by the binary
 * pipeline's install step — see
 * `projects/code/engineering/desktop/design-binary-pipeline.md`) and
 * returns a map of schema-binary key to absolute on-disk path.
 *
 * Entries whose resolved path does not exist on disk are skipped.
 *
 * On any failure (missing manifest, malformed JSON, schema violation),
 * returns an empty map and logs a warning. Callers treat `{}` as "no
 * bundled defaults available" — consistent with `listBundledBinaryFiles`.
 *
 * Intentionally uncached: reading on every invocation lets a manifest
 * swap during dev take effect without restarting the app.
 */
export async function readBundledBinaryDefaults(): Promise<Record<string, string>> {
	const directory = getBundledBinariesPath();
	const manifestPath = path.join(directory, "manifest.json");

	let raw: string;

	try {
		raw = await fs.readFile(manifestPath, "utf8");
	} catch (error) {
		console.warn(`[bundledBinaries] Failed to read manifest at ${manifestPath}:`, error);

		return {};
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		console.warn(`[bundledBinaries] Malformed JSON in manifest at ${manifestPath}:`, error);

		return {};
	}

	const result = bundledBinariesManifestSchema.safeParse(parsed);

	if (!result.success) {
		console.warn(`[bundledBinaries] Manifest at ${manifestPath} failed schema validation:`, result.error);

		return {};
	}

	const resolved: Record<string, string> = {};

	for (const [key, filename] of Object.entries(result.data.binaries)) {
		const absolutePath = path.join(directory, filename);

		try {
			await fs.stat(absolutePath);
		} catch {
			continue;
		}

		resolved[key] = absolutePath;
	}

	return resolved;
}
