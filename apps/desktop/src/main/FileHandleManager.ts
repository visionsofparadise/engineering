import fs from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

export class FileHandleManager {
	private readonly handles = new Map<string, FileHandle>();

	async open(filePath: string): Promise<string> {
		const handle = await fs.open(filePath, "r");
		const handleId = crypto.randomUUID();

		this.handles.set(handleId, handle);

		return handleId;
	}

	async read(handleId: string, offset: number, length: number): Promise<ArrayBuffer> {
		const handle = this.handles.get(handleId);

		if (!handle) {
			throw new Error(`File handle not found: ${handleId}`);
		}

		const buffer = Buffer.alloc(length);
		const { bytesRead } = await handle.read(buffer, 0, length, offset);

		return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + bytesRead);
	}

	async close(handleId: string): Promise<void> {
		const handle = this.handles.get(handleId);

		if (!handle) return;

		await handle.close();
		this.handles.delete(handleId);
	}

	async dispose(): Promise<void> {
		for (const [handleId] of this.handles) {
			await this.close(handleId);
		}
	}
}
