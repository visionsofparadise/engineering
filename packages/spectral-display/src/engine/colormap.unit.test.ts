import { describe, expect, it } from "vitest";
import { lavaColormap } from "../utils/lava";
import { viridisColormap } from "../utils/viridis";
import { generateColormapBuffer, resolveColormap, resolveWaveformColor } from "./colormap";

describe("generateColormapBuffer", () => {
	it("generates 256x4 byte buffer", () => {
		const buffer = generateColormapBuffer(lavaColormap);

		expect(buffer.length).toBe(256 * 4);
	});

	it("lava entry 0 is approximately [0, 0, 0, 255]", () => {
		const buffer = generateColormapBuffer(lavaColormap);

		expect(buffer[0]).toBe(0);
		expect(buffer[1]).toBe(0);
		expect(buffer[2]).toBe(0);
		expect(buffer[3]).toBe(255);
	});

	it("lava entry 255 is approximately [255, 255, 255, 255]", () => {
		const buffer = generateColormapBuffer(lavaColormap);
		const offset = 255 * 4;

		expect(buffer[offset]).toBe(255);
		expect(buffer[offset + 1]).toBe(255);
		expect(buffer[offset + 2]).toBe(255);
		expect(buffer[offset + 3]).toBe(255);
	});

	it("viridis entry 0 is approximately [68, 1, 84, 255]", () => {
		const buffer = generateColormapBuffer(viridisColormap);

		expect(buffer[0]).toBe(68);
		expect(buffer[1]).toBe(1);
		expect(buffer[2]).toBe(84);
		expect(buffer[3]).toBe(255);
	});

	it("all alpha values are 255", () => {
		const buffer = generateColormapBuffer(lavaColormap);

		for (let index = 0; index < 256; index++) {
			expect(buffer[index * 4 + 3]).toBe(255);
		}
	});
});

describe("resolveColormap", () => {
	it("resolves lava string to lava definition", () => {
		const result = resolveColormap("lava");

		expect(result).toBe(lavaColormap);
	});

	it("resolves viridis string to viridis definition", () => {
		const result = resolveColormap("viridis");

		expect(result).toBe(viridisColormap);
	});

	it("passes through custom colormap definition", () => {
		const custom = {
			colors: [
				{ position: 0, color: [0, 0, 0] as const },
				{ position: 1, color: [255, 255, 255] as const },
			],
		};

		const result = resolveColormap(custom);

		expect(result).toBe(custom);
	});
});

describe("resolveWaveformColor", () => {
	it("returns override when provided", () => {
		const result = resolveWaveformColor("lava", [100, 200, 50]);

		expect(result).toEqual([100, 200, 50]);
	});

	it("returns lava default when no override", () => {
		const result = resolveWaveformColor("lava");

		expect(result).toEqual([40, 135, 180]);
	});

	it("returns viridis default when no override", () => {
		const result = resolveWaveformColor("viridis");

		expect(result).toEqual([180, 115, 42]);
	});

	it("returns gray default for custom colormap", () => {
		const custom = {
			colors: [
				{ position: 0, color: [0, 0, 0] as const },
				{ position: 1, color: [255, 255, 255] as const },
			],
		};

		const result = resolveWaveformColor(custom);

		expect(result).toEqual([200, 200, 200]);
	});
});
