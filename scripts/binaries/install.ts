/**
 * Install the target-filtered subset of bundled binaries into
 * `apps/desktop/binaries/`, alongside an install-time `manifest.json`
 * that maps schema binary keys to on-disk filenames.
 *
 * Usage:
 *   npm run binaries:install -- [--target <platform>-<arch>]
 *
 * Behaviour:
 *   - Hydrates the cache by running the fetch logic first (downloads
 *     any missing entries for the target, verifies sha256).
 *   - Clears existing regular files at the top level of
 *     `apps/desktop/binaries/` so stale per-arch binaries from a prior
 *     target don't leak. Subdirectories and dotfiles are left alone.
 *   - Copies each included cache entry to
 *     `apps/desktop/binaries/<filename>`.
 *   - Writes `apps/desktop/binaries/manifest.json`:
 *       { target: "<platform>-<arch>",
 *         binaries: { [schemaKey]: filename } }
 *     Only assets with a non-null `key` appear in `binaries`. Unkeyed
 *     assets (e.g. onnxruntime-*.dll, htdemucs.onnx.data) are present
 *     on disk but not exposed to the schema layer.
 *   - For non-Windows targets, sets the executable bit (0o755) on
 *     ffmpeg/ffprobe so the packaged app can spawn them on Linux/macOS.
 */
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";

import { fetchForTarget } from "./fetch.ts";
import {
	formatTarget,
	type Manifest,
	type ManifestAsset,
	parseTargetArgs,
	resolveRepoRoot,
	type Target,
} from "./manifest.ts";

function resolveDesktopBinariesDir(): string {
	return path.join(resolveRepoRoot(), "apps", "desktop", "binaries");
}

/**
 * Removes every regular file at the top level of `directory`, leaving
 * the directory itself, any subdirectories, and any dotfiles in place.
 *
 * Dotfiles are preserved because they may include tooling markers
 * (e.g. .gitkeep) that should survive a repopulation.
 */
async function clearTopLevelRegularFiles(directory: string): Promise<number> {
	let entries: Array<Dirent>;

	try {
		entries = await fs.readdir(directory, { withFileTypes: true });
	} catch (error: unknown) {
		if (
			error !== null &&
			typeof error === "object" &&
			(error as { code?: unknown }).code === "ENOENT"
		) {
			await fs.mkdir(directory, { recursive: true });

			return 0;
		}

		throw error;
	}

	let removed = 0;

	for (const entry of entries) {
		if (!entry.isFile()) continue;
		if (entry.name.startsWith(".")) continue;

		await fs.rm(path.join(directory, entry.name), { force: true });
		removed += 1;
	}

	return removed;
}

/**
 * Copies `source` to `destination`, replacing an existing file. On
 * non-Windows targets, sets executable permission on ffmpeg/ffprobe so
 * the packaged app can spawn them.
 */
async function installAsset(
	source: string,
	destination: string,
	asset: ManifestAsset,
	target: Target,
): Promise<void> {
	await fs.copyFile(source, destination);

	if (target.platform !== "win32" && (asset.key === "ffmpeg" || asset.key === "ffprobe")) {
		await fs.chmod(destination, 0o755);
	}
}

function buildSchemaKeyMap(included: ReadonlyArray<ManifestAsset>): Record<string, string> {
	const map: Record<string, string> = {};

	for (const asset of included) {
		if (asset.key === null) continue;

		map[asset.key] = asset.filename;
	}

	return map;
}

export async function installForTarget(target: Target): Promise<{
	manifest: Manifest;
	included: Array<ManifestAsset>;
	destinationDir: string;
	schemaKeyMap: Record<string, string>;
}> {
	const { manifest, included, cachePaths } = await fetchForTarget(target);
	const destinationDir = resolveDesktopBinariesDir();

	const removed = await clearTopLevelRegularFiles(destinationDir);

	console.warn(`[install] cleared ${removed} file(s) from ${destinationDir}`);

	for (const asset of included) {
		const cachePath = cachePaths.get(asset.filename);

		if (cachePath === undefined) {
			throw new Error(
				`Internal error: cache path missing for ${asset.filename} after fetch`,
			);
		}

		const destination = path.join(destinationDir, asset.filename);

		await installAsset(cachePath, destination, asset, target);
		console.warn(`[install] copy   ${asset.filename}`);
	}

	const schemaKeyMap = buildSchemaKeyMap(included);

	const installManifest = {
		target: formatTarget(target),
		binaries: schemaKeyMap,
	};

	const manifestPath = path.join(destinationDir, "manifest.json");

	await fs.writeFile(manifestPath, `${JSON.stringify(installManifest, null, 2)}\n`, "utf8");
	console.warn(`[install] wrote ${manifestPath}`);

	return { manifest, included, destinationDir, schemaKeyMap };
}

async function main(): Promise<void> {
	const target = parseTargetArgs(process.argv.slice(2));

	const { included, schemaKeyMap } = await installForTarget(target);

	console.warn(
		`[install] done — ${included.length} asset(s) installed for ${formatTarget(target)} (${Object.keys(schemaKeyMap).length} schema keys)`,
	);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
