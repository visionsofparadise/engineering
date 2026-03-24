import { describe, expect, it } from "vitest";
import { lavaColormap } from "../utils/lava";
import { resolveConfig } from "./SpectralEngine";

const mockDevice = {} as GPUDevice;
const mockSignal = new AbortController().signal;

describe("resolveConfig", () => {
	it("returns all defaults when only device and signal provided", () => {
		const result = resolveConfig({ device: mockDevice, signal: mockSignal });

		expect(result.fftSize).toBe(4096);
		expect(result.frequencyScale).toBe("log");
		expect(result.dbRange).toEqual([-120, 0]);
		expect(result.colormap).toEqual(lavaColormap);
		expect(result.waveformColor).toEqual([40, 135, 180]);
		expect(result.device).toBe(mockDevice);
		expect(result.signal).toBe(mockSignal);
	});

	it("uses provided values and defaults the rest for partial options", () => {
		const result = resolveConfig({
			device: mockDevice,
			signal: mockSignal,
			fftSize: 2048,
			dbRange: [-80, -10],
		});

		expect(result.fftSize).toBe(2048);
		expect(result.dbRange).toEqual([-80, -10]);
		expect(result.frequencyScale).toBe("log");
		expect(result.colormap).toEqual(lavaColormap);
		expect(result.waveformColor).toEqual([40, 135, 180]);
	});

	it("uses all provided values when full options given", () => {
		const customColormap = {
			colors: [
				{ position: 0, color: [0, 0, 0] as const },
				{ position: 1, color: [255, 255, 255] as const },
			],
		};

		const result = resolveConfig({
			device: mockDevice,
			signal: mockSignal,
			fftSize: 8192,
			frequencyScale: "mel",
			dbRange: [-90, -5],
			colormap: customColormap,
			waveformColor: [255, 0, 0],
		});

		expect(result.fftSize).toBe(8192);
		expect(result.frequencyScale).toBe("mel");
		expect(result.dbRange).toEqual([-90, -5]);
		expect(result.colormap).toEqual(customColormap);
		expect(result.waveformColor).toEqual([255, 0, 0]);
	});
});
