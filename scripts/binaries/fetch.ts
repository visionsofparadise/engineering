/**
 * Fetch bundled-binary assets from the content-addressed S3 bucket into a
 * local cache at `<repo>/.binaries-cache/<sha256>/<filename>`.
 *
 * Usage:
 *   npm run binaries:fetch -- [--target <platform>-<arch>]
 *
 * Default target is the host platform/arch. The cache is shared across
 * all consumers on a machine and is content-addressed by sha256 — a
 * manifest bump never invalidates a cache entry.
 *
 * Reads are public (see service/design-service.md), so this script uses
 * Node's built-in `fetch` and `crypto` and intentionally does NOT pull in
 * the AWS SDK.
 *
 * Exit codes:
 *   0 — all included assets present in cache with verified sha256.
 *   1 — download failure, hash mismatch, or any other fatal error.
 */
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
	assetUrl,
	filterAssetsForTarget,
	formatTarget,
	type Manifest,
	type ManifestAsset,
	parseTargetArgs,
	readManifest,
	resolveRepoRoot,
	type Target,
} from "./manifest.ts";

export function resolveCacheDir(): string {
	return path.join(resolveRepoRoot(), ".binaries-cache");
}

async function sha256File(filePath: string): Promise<string> {
	const hash = createHash("sha256");
	const handle = await fs.open(filePath, "r");

	try {
		const stream = handle.createReadStream();

		for await (const chunk of stream) {
			hash.update(chunk as Buffer);
		}
	} finally {
		await handle.close();
	}

	return hash.digest("hex");
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);

		return true;
	} catch {
		return false;
	}
}

/**
 * Downloads `url` to `destination`, verifying sha256 streamed during the
 * write. Writes to a sibling `.tmp` file and renames into place on
 * success; throws on hash mismatch without leaving a corrupt file in
 * place of the final path.
 */
async function downloadAndVerify(
	url: string,
	destination: string,
	expectedSha256: string,
): Promise<void> {
	const tempPath = `${destination}.tmp`;

	await fs.mkdir(path.dirname(destination), { recursive: true });

	const response = await fetch(url);

	if (!response.ok || response.body === null) {
		throw new Error(
			`Download failed for ${url}: HTTP ${response.status} ${response.statusText}`,
		);
	}

	const hash = createHash("sha256");
	const writeStream = createWriteStream(tempPath);
	const bodyStream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);

	try {
		await pipeline(
			bodyStream,
			async function* (source: AsyncIterable<Buffer | Uint8Array>) {
				for await (const chunk of source) {
					const buf = chunk instanceof Buffer ? chunk : Buffer.from(chunk);

					hash.update(buf);
					yield buf;
				}
			},
			writeStream,
		);
	} catch (error) {
		// Best-effort cleanup of partial temp file.
		await fs.rm(tempPath, { force: true });
		throw error;
	}

	const actualSha256 = hash.digest("hex");

	if (actualSha256 !== expectedSha256) {
		await fs.rm(tempPath, { force: true });
		throw new Error(
			`sha256 mismatch for ${url} — expected ${expectedSha256}, got ${actualSha256}`,
		);
	}

	await fs.rename(tempPath, destination);
}

/**
 * Ensures a single asset is present in the cache at
 * `<cacheDir>/<sha256>/<filename>` with a verified hash. Returns the
 * absolute path of the cache entry.
 */
export async function ensureCached(
	manifest: Manifest,
	asset: ManifestAsset,
	cacheDir: string,
): Promise<string> {
	const assetDir = path.join(cacheDir, asset.sha256);
	const cachePath = path.join(assetDir, asset.filename);

	if (await fileExists(cachePath)) {
		const existingSha256 = await sha256File(cachePath);

		if (existingSha256 === asset.sha256) {
			console.warn(`[fetch] cache hit  ${asset.filename}`);

			return cachePath;
		}

		console.warn(
			`[fetch] cache corrupt ${asset.filename} (sha256 ${existingSha256} != ${asset.sha256}) — re-downloading`,
		);

		await fs.rm(cachePath, { force: true });
	}

	const url = assetUrl(manifest, asset);

	console.warn(`[fetch] download   ${asset.filename} <- ${url}`);

	await downloadAndVerify(url, cachePath, asset.sha256);

	return cachePath;
}

export async function fetchForTarget(target: Target): Promise<{
	manifest: Manifest;
	included: Array<ManifestAsset>;
	cacheDir: string;
	cachePaths: Map<string, string>;
}> {
	const manifest = await readManifest();
	const included = filterAssetsForTarget(manifest.assets, target);
	const cacheDir = resolveCacheDir();

	console.warn(`[fetch] target: ${formatTarget(target)}`);
	console.warn(`[fetch] cache:  ${cacheDir}`);
	console.warn(`[fetch] assets: ${included.length}`);

	const cachePaths = new Map<string, string>();

	for (const asset of included) {
		const cachePath = await ensureCached(manifest, asset, cacheDir);

		cachePaths.set(asset.filename, cachePath);
	}

	return { manifest, included, cacheDir, cachePaths };
}

async function main(): Promise<void> {
	const target = parseTargetArgs(process.argv.slice(2));

	const { included } = await fetchForTarget(target);

	console.warn(`[fetch] done — ${included.length} assets cached for ${formatTarget(target)}`);
}

// Run main only when this file is executed directly (not when imported
// by install.ts). `import.meta.url` is a file:// URL; process.argv[1] is
// a filesystem path — convert it to a file:// URL before comparing.
const entryArgv = process.argv[1];

if (entryArgv !== undefined && import.meta.url === pathToFileURL(entryArgv).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
