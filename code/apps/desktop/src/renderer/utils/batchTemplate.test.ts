import { describe, expect, it } from "vitest";
import { resolveTemplate } from "./batchTemplate";

describe("resolveTemplate", () => {
	it("resolves all template variables", () => {
		expect(resolveTemplate("{name}-{index:3}", { name: "audio", ext: "wav" }, 5)).toBe("audio-005");
	});

	it("resolves {name}", () => {
		expect(resolveTemplate("{name}", { name: "my-file", ext: "flac" }, 0)).toBe("my-file");
	});

	it("resolves {ext}", () => {
		expect(resolveTemplate("{name}.{ext}", { name: "audio", ext: "wav" }, 0)).toBe("audio.wav");
	});

	it("resolves {index} without padding", () => {
		expect(resolveTemplate("{index}-{name}", { name: "audio", ext: "wav" }, 42)).toBe("42-audio");
	});

	it("resolves {index:N} with zero padding", () => {
		expect(resolveTemplate("{index:4}", { name: "audio", ext: "wav" }, 7)).toBe("0007");
	});

	it("handles empty name", () => {
		expect(resolveTemplate("{name}", { name: "", ext: "" }, 0)).toBe("");
	});

	it("handles large index", () => {
		expect(resolveTemplate("{index:3}", { name: "a", ext: "wav" }, 1000)).toBe("1000");
	});

	it("returns template unchanged when no variables", () => {
		expect(resolveTemplate("output", { name: "a", ext: "wav" }, 0)).toBe("output");
	});
});
