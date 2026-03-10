import { protocol } from "electron";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

const MIME_TYPES: Record<string, string> = {
	".wav": "audio/wav",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".flac": "audio/flac",
	".aac": "audio/aac",
	".m4a": "audio/mp4",
};

function getMimeType(filePath: string): string {
	return MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function parseRangeHeader(rangeHeader: string, fileSize: number): { start: number; end: number } | undefined {
	const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader);

	if (!match?.[1]) return undefined;

	const start = parseInt(match[1], 10);
	const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

	if (start >= fileSize || end >= fileSize || start > end) return undefined;

	return { start, end };
}

export function registerMediaScheme(): void {
	protocol.registerSchemesAsPrivileged([
		{
			scheme: "media",
			privileges: {
				stream: true,
				supportFetchAPI: true,
			},
		},
	]);
}

export function registerMediaProtocol(): void {
	protocol.handle("media", async (request) => {
		const url = new URL(request.url);
		const filePath = decodeURIComponent(url.pathname).replace(/^\/+/, "");

		let fileStats: Awaited<ReturnType<typeof stat>>;

		try {
			fileStats = await stat(filePath);
		} catch {
			return new Response("File not found", { status: 404 });
		}

		const fileSize = fileStats.size;
		const mimeType = getMimeType(filePath);
		const rangeHeader = request.headers.get("range");

		if (rangeHeader) {
			const range = parseRangeHeader(rangeHeader, fileSize);

			if (!range) {
				return new Response("Range not satisfiable", {
					status: 416,
					headers: { "Content-Range": `bytes */${fileSize}` },
				});
			}

			const { start, end } = range;
			const chunkSize = end - start + 1;
			const buffer = Buffer.alloc(chunkSize);
			const fullBuffer = await readFile(filePath);
			fullBuffer.copy(buffer, 0, start, end + 1);

			return new Response(buffer, {
				status: 206,
				headers: {
					"Content-Type": mimeType,
					"Content-Length": String(chunkSize),
					"Content-Range": `bytes ${start}-${end}/${fileSize}`,
					"Accept-Ranges": "bytes",
				},
			});
		}

		const buffer = await readFile(filePath);

		return new Response(buffer, {
			status: 200,
			headers: {
				"Content-Type": mimeType,
				"Content-Length": String(fileSize),
				"Accept-Ranges": "bytes",
			},
		});
	});
}
