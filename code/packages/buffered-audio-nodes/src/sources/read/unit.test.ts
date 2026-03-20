import { describe, expect, it } from "vitest";
import { read, ReadNode } from ".";

describe("ReadNode", () => {
	it("creates ReadWavStream for .wav files", () => {
		const node = new ReadNode({ path: "test.wav", ffmpegPath: "", ffprobePath: "" });
		const node2 = read("file.wav");

		expect(node).toBeInstanceOf(ReadNode);
		expect(node2).toBeInstanceOf(ReadNode);
	});

	it("throws for non-WAV files without ffmpeg paths", async () => {
		const node = new ReadNode({ path: "test.mp3", ffmpegPath: "", ffprobePath: "" });

		await expect(node.getMetadata()).rejects.toThrow("Non-WAV file requires ffmpegPath and ffprobePath");
	});

	it("throws for non-WAV files when only ffmpegPath is set", async () => {
		const node = new ReadNode({ path: "test.flac", ffmpegPath: "/usr/bin/ffmpeg", ffprobePath: "" });

		await expect(node.getMetadata()).rejects.toThrow("Non-WAV file requires ffmpegPath and ffprobePath");
	});

	it("throws for non-WAV files when only ffprobePath is set", async () => {
		const node = new ReadNode({ path: "test.ogg", ffmpegPath: "", ffprobePath: "/usr/bin/ffprobe" });

		await expect(node.getMetadata()).rejects.toThrow("Non-WAV file requires ffmpegPath and ffprobePath");
	});
});
