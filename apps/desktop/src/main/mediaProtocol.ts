import fs from "fs/promises";
import { protocol } from "electron";

const AUDIO_CONTENT_TYPE = "audio/wav";

function parseRangeHeader(range: string, fileSize: number): { start: number; end: number } {
	const match = /bytes=(\d+)-(\d*)/.exec(range);

	if (!match) throw new Error(`Invalid Range header: ${range}`);

	const start = parseInt(match[1] ?? "0", 10);
	const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

	return { start, end };
}

export function registerMediaProtocol(): void {
	protocol.handle("media", async (request) => {
		const url = new URL(request.url);
		const filePath = decodeURIComponent(url.pathname);

		const fileHandle = await fs.open(filePath, "r");

		try {
			const stats = await fileHandle.stat();
			const fileSize = stats.size;
			const rangeHeader = request.headers.get("Range");

			if (!rangeHeader) {
				const buffer = Buffer.alloc(fileSize);

				await fileHandle.read(buffer, 0, fileSize, 0);
				await fileHandle.close();

				return new Response(buffer, {
					headers: {
						"Content-Type": AUDIO_CONTENT_TYPE,
						"Content-Length": String(fileSize),
						"Accept-Ranges": "bytes",
					},
				});
			}

			const { start, end } = parseRangeHeader(rangeHeader, fileSize);
			const length = end - start + 1;
			const buffer = Buffer.alloc(length);

			await fileHandle.read(buffer, 0, length, start);
			await fileHandle.close();

			return new Response(buffer, {
				status: 206,
				headers: {
					"Content-Type": AUDIO_CONTENT_TYPE,
					"Content-Range": `bytes ${start}-${end}/${fileSize}`,
					"Content-Length": String(length),
					"Accept-Ranges": "bytes",
				},
			});
		} catch (error) {
			await fileHandle.close();

			throw error;
		}
	});
}
