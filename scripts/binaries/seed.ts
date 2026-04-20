/**
 * Seed the canonical binaries S3 bucket from a local directory and
 * regenerate `binaries.manifest.json` at the repo root.
 *
 * Usage:
 *   npm run binaries:seed -- [--from <dir>] [--profile <name>]
 *
 * Defaults: `--from apps/desktop/binaries`, `--profile engineering`.
 *
 * Content-addressed uploads: each file's key is `sha256/<hex>` so
 * re-uploads of unchanged bytes are no-ops. Existing objects are
 * checked via `HeadObject` before `PutObject`.
 *
 * The `ASSET_METADATA` table below is the hand-maintained mapping
 * from on-disk filename to schema key, target platform/arch, and
 * provenance URL. Adding or renaming a bundled binary means editing
 * this file.
 */
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface AssetMetadata {
	// Schema binary key in @e9g/buffered-audio-nodes Zod schemas, or null
	// for assets that are installed to disk but not exposed as a schema
	// binary (e.g. ONNX Runtime shared libs loaded dynamically by the
	// addon; HTDemucs external-data sidecar loaded automatically by ORT).
	key: string | null;
	platform: "all" | "win32" | "linux" | "darwin";
	arch: "all" | "x64" | "arm64";
	// Canonical upstream URL this copy was seeded from. Documentation only.
	source: string;
}

interface ManifestAsset extends AssetMetadata {
	filename: string;
	sha256: string;
	size: number;
}

interface Manifest {
	version: number;
	bucket: string;
	region: string;
	assets: Array<ManifestAsset>;
}

const BUCKET = "engineering-binaries-345340320424";
const REGION = "us-east-1";
const MANIFEST_VERSION = 1;

// ffmpeg/ffprobe win32-x64 and linux-x64 are sourced from a pinned BtbN
// autobuild release. darwin-arm64 is sourced from a pinned Martin Riedl
// release-8.1 build (LGPL not available for arm64; selected for parity with
// BtbN which also links x264/x265).
const FFMPEG_SOURCE = "https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-04-18-13-04";
const FFMPEG_DARWIN_ARM64_SOURCE =
	"https://ffmpeg.martin-riedl.de/download/macos/arm64/1774549676_8.1/ffmpeg.zip";
const FFPROBE_DARWIN_ARM64_SOURCE =
	"https://ffmpeg.martin-riedl.de/download/macos/arm64/1774549676_8.1/ffprobe.zip";

// Addon sources point at the v1.0.0 release-tag pages on each repo.
// The release assets are produced by each repo's Build workflow when
// package.json version changes. See Phase 6 of plan-binaries-pipeline.
const ONNX_ADDON_SOURCE = "https://github.com/visionsofparadise/onnx-runtime-addon/releases/tag/v1.0.1";
const VKFFT_ADDON_SOURCE = "https://github.com/visionsofparadise/vkfft-addon/releases/tag/v1.0.0";
const FFTW_ADDON_SOURCE = "https://github.com/visionsofparadise/fftw-addon/releases/tag/v1.0.0";

// HTDemucs: user-specified source (overrides the plan's default proposal).
const HTDEMUCS_SOURCE = "https://github.com/facebookresearch/demucs";

const ASSET_METADATA: Readonly<Record<string, AssetMetadata>> = {
	// ---- Models (platform/arch: all) ----
	"dtln-model_1.onnx": {
		key: "dtln-model_1",
		platform: "all",
		arch: "all",
		source: "https://github.com/breizhn/DTLN",
	},
	"dtln-model_2.onnx": {
		key: "dtln-model_2",
		platform: "all",
		arch: "all",
		source: "https://github.com/breizhn/DTLN",
	},
	"Kim_Vocal_2.onnx": {
		key: "Kim_Vocal_2",
		platform: "all",
		arch: "all",
		source: "https://huggingface.co/seanghay/uvr_models",
	},
	"htdemucs.onnx": {
		key: "htdemucs",
		platform: "all",
		arch: "all",
		source: HTDEMUCS_SOURCE,
	},
	"htdemucs.onnx.data": {
		// ONNX external-data sidecar. Loaded automatically by ONNX Runtime
		// from the same directory as htdemucs.onnx. Not a schema binary.
		key: null,
		platform: "all",
		arch: "all",
		source: HTDEMUCS_SOURCE,
	},

	// ---- ffmpeg / ffprobe ----
	"ffmpeg-win32-x64.exe": {
		key: "ffmpeg",
		platform: "win32",
		arch: "x64",
		source: FFMPEG_SOURCE,
	},
	"ffmpeg-linux-x64": {
		key: "ffmpeg",
		platform: "linux",
		arch: "x64",
		source: FFMPEG_SOURCE,
	},
	"ffprobe-win32-x64.exe": {
		key: "ffprobe",
		platform: "win32",
		arch: "x64",
		source: FFMPEG_SOURCE,
	},
	"ffprobe-linux-x64": {
		key: "ffprobe",
		platform: "linux",
		arch: "x64",
		source: FFMPEG_SOURCE,
	},
	"ffmpeg-darwin-arm64": {
		key: "ffmpeg",
		platform: "darwin",
		arch: "arm64",
		source: FFMPEG_DARWIN_ARM64_SOURCE,
	},
	"ffprobe-darwin-arm64": {
		key: "ffprobe",
		platform: "darwin",
		arch: "arm64",
		source: FFPROBE_DARWIN_ARM64_SOURCE,
	},

	// ---- ONNX Runtime addon (.node) ----
	"onnx-runtime-addon-win32-x64.node": {
		key: "onnx-addon",
		platform: "win32",
		arch: "x64",
		source: ONNX_ADDON_SOURCE,
	},
	"onnx-runtime-addon-linux-x64.node": {
		key: "onnx-addon",
		platform: "linux",
		arch: "x64",
		source: ONNX_ADDON_SOURCE,
	},
	"onnx-runtime-addon-darwin-arm64.node": {
		key: "onnx-addon",
		platform: "darwin",
		arch: "arm64",
		source: ONNX_ADDON_SOURCE,
	},

	// ---- ONNX Runtime shared libraries (loaded dynamically, not a schema binary) ----
	"onnxruntime-win32-x64.dll": {
		key: null,
		platform: "win32",
		arch: "x64",
		source: ONNX_ADDON_SOURCE,
	},
	"onnxruntime-linux-x64.so": {
		key: null,
		platform: "linux",
		arch: "x64",
		source: ONNX_ADDON_SOURCE,
	},
	"onnxruntime-darwin-arm64.dylib": {
		key: null,
		platform: "darwin",
		arch: "arm64",
		source: ONNX_ADDON_SOURCE,
	},

	// ---- vkfft addon ----
	"vkfft-win32-x64.node": {
		key: "vkfft-addon",
		platform: "win32",
		arch: "x64",
		source: VKFFT_ADDON_SOURCE,
	},
	"vkfft-linux-x64.node": {
		key: "vkfft-addon",
		platform: "linux",
		arch: "x64",
		source: VKFFT_ADDON_SOURCE,
	},
	"vkfft-darwin-arm64.node": {
		key: "vkfft-addon",
		platform: "darwin",
		arch: "arm64",
		source: VKFFT_ADDON_SOURCE,
	},

	// ---- fftw addon ----
	"fftw-win32-x64.node": {
		key: "fftw-addon",
		platform: "win32",
		arch: "x64",
		source: FFTW_ADDON_SOURCE,
	},
	"fftw-linux-x64.node": {
		key: "fftw-addon",
		platform: "linux",
		arch: "x64",
		source: FFTW_ADDON_SOURCE,
	},
	"fftw-darwin-arm64.node": {
		key: "fftw-addon",
		platform: "darwin",
		arch: "arm64",
		source: FFTW_ADDON_SOURCE,
	},
};

interface CliArgs {
	from: string;
	profile: string;
}

function parseArgs(argv: ReadonlyArray<string>): CliArgs {
	const result: CliArgs = {
		from: "apps/desktop/binaries",
		profile: "engineering",
	};

	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index];

		if (token === "--from") {
			const next = argv[index + 1];

			if (next === undefined) throw new Error("--from requires a value");

			result.from = next;
			index += 1;
		} else if (token === "--profile") {
			const next = argv[index + 1];

			if (next === undefined) throw new Error("--profile requires a value");

			result.profile = next;
			index += 1;
		} else if (token !== undefined) {
			throw new Error(`Unknown argument: ${token}`);
		}
	}

	return result;
}

async function sha256File(filePath: string): Promise<string> {
	const buffer = await readFile(filePath);
	const hash = createHash("sha256");

	hash.update(buffer);

	return hash.digest("hex");
}

async function objectExists(client: S3Client, bucket: string, key: string): Promise<boolean> {
	try {
		await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));

		return true;
	} catch (error: unknown) {
		// S3 returns 404 for missing objects; the SDK surfaces this as a
		// NotFound error (or a 404 HTTP status on the response metadata).
		if (error !== null && typeof error === "object") {
			const maybeName = (error as { name?: unknown }).name;
			const maybeStatus = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
				?.httpStatusCode;

			if (maybeName === "NotFound" || maybeStatus === 404) return false;
		}

		throw error;
	}
}

function compareAssets(first: ManifestAsset, second: ManifestAsset): number {
	const firstKey = first.key ?? "";
	const secondKey = second.key ?? "";

	if (firstKey !== secondKey) return firstKey < secondKey ? -1 : 1;
	if (first.platform !== second.platform) return first.platform < second.platform ? -1 : 1;
	if (first.arch !== second.arch) return first.arch < second.arch ? -1 : 1;
	if (first.filename !== second.filename) return first.filename < second.filename ? -1 : 1;

	return 0;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	// Resolve source directory relative to process cwd (repo root when run via npm).
	const sourceDir = path.resolve(process.cwd(), args.from);
	// Manifest lives at the repo root. This script lives at
	// <repo>/scripts/binaries/seed.ts, so ../../binaries.manifest.json
	// relative to the script file is the repo root manifest.
	const scriptDir = path.dirname(fileURLToPath(import.meta.url));
	const repoRoot = path.resolve(scriptDir, "..", "..");
	const manifestPath = path.join(repoRoot, "binaries.manifest.json");

	console.warn(`[seed] source: ${sourceDir}`);
	console.warn(`[seed] profile: ${args.profile}`);
	console.warn(`[seed] bucket: ${BUCKET}`);
	console.warn(`[seed] manifest: ${manifestPath}`);

	const entries = await readdir(sourceDir, { withFileTypes: true });
	const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();

	const client = new S3Client({
		region: REGION,
		credentials: fromIni({ profile: args.profile }),
	});

	const assets: Array<ManifestAsset> = [];
	let uploaded = 0;
	let skipped = 0;

	for (const filename of files) {
		const metadata = ASSET_METADATA[filename];

		if (metadata === undefined) {
			console.warn(`[seed] WARNING: no ASSET_METADATA entry for ${filename} — skipping`);
			continue;
		}

		const filePath = path.join(sourceDir, filename);
		const fileStat = await stat(filePath);
		const sha256 = await sha256File(filePath);
		const objectKey = `sha256/${sha256}`;

		const exists = await objectExists(client, BUCKET, objectKey);

		if (exists) {
			console.warn(`[seed] skip (exists) ${filename} -> ${objectKey}`);
			skipped += 1;
		} else {
			const body = await readFile(filePath);

			await client.send(
				new PutObjectCommand({
					Bucket: BUCKET,
					Key: objectKey,
					Body: body,
					ContentType: "application/octet-stream",
				}),
			);

			console.warn(`[seed] upload       ${filename} -> ${objectKey} (${fileStat.size} bytes)`);
			uploaded += 1;
		}

		assets.push({
			key: metadata.key,
			platform: metadata.platform,
			arch: metadata.arch,
			filename,
			sha256,
			size: fileStat.size,
			source: metadata.source,
		});
	}

	assets.sort(compareAssets);

	const manifest: Manifest = {
		version: MANIFEST_VERSION,
		bucket: BUCKET,
		region: REGION,
		assets,
	};

	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

	console.warn(`[seed] done — ${uploaded} uploaded, ${skipped} skipped, ${assets.length} assets in manifest`);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
