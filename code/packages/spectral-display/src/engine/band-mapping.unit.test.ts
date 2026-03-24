import { describe, expect, it } from "vitest";
import { computeBandMappings } from "./band-mapping";

describe("computeBandMappings", () => {
  it("returns empty array for linear scale", () => {
    const result = computeBandMappings("linear", 512, 44100, 4096);

    expect(result.length).toBe(0);
  });

  it("returns correct number of entries for log scale", () => {
    const result = computeBandMappings("log", 512, 44100, 4096);

    expect(result.length).toBe(512 * 4);
  });

  it("produces valid bin ranges for log scale at 44.1kHz/4096", () => {
    const result = computeBandMappings("log", 512, 44100, 4096);
    const numLinearBins = 4096 / 2 + 1;

    for (let band = 0; band < 512; band++) {
      const offset = band * 4;
      const binStart = result[offset]!;
      const binEnd = result[offset + 1]!;
      const weightStart = result[offset + 2]!;
      const weightEnd = result[offset + 3]!;

      expect(binStart).toBeGreaterThanOrEqual(0);
      expect(binEnd).toBeLessThan(numLinearBins);
      expect(binEnd).toBeGreaterThanOrEqual(binStart);
      expect(weightStart).toBeGreaterThanOrEqual(0);
      expect(weightStart).toBeLessThanOrEqual(1);
      expect(weightEnd).toBeGreaterThanOrEqual(0);
      expect(weightEnd).toBeLessThanOrEqual(1);
    }
  });

  it("first band starts near bin 0 for log scale", () => {
    const result = computeBandMappings("log", 512, 44100, 4096);
    const firstBinStart = result[0]!;

    expect(firstBinStart).toBeLessThanOrEqual(2);
  });

  it("last band reaches near Nyquist for log scale", () => {
    const result = computeBandMappings("log", 512, 44100, 4096);
    const lastOffset = 511 * 4;
    const lastBinEnd = result[lastOffset + 1]!;
    const numLinearBins = 4096 / 2 + 1;

    expect(lastBinEnd).toBeGreaterThan(numLinearBins - 10);
  });

  it("returns correct number of entries for mel scale", () => {
    const result = computeBandMappings("mel", 512, 44100, 4096);

    expect(result.length).toBe(512 * 4);
  });

  it("returns correct number of entries for erb scale", () => {
    const result = computeBandMappings("erb", 512, 44100, 4096);

    expect(result.length).toBe(512 * 4);
  });

  it("handles small FFT size (256) at 44100Hz", () => {
    const fftSize = 256;
    const numBands = 512;
    const result = computeBandMappings("log", numBands, 44100, fftSize);
    const numLinearBins = fftSize / 2 + 1;

    expect(result.length).toBe(numBands * 4);

    for (let band = 0; band < numBands; band++) {
      const offset = band * 4;
      const binStart = result[offset]!;
      const binEnd = result[offset + 1]!;
      const weightStart = result[offset + 2]!;
      const weightEnd = result[offset + 3]!;

      expect(binStart).toBeGreaterThanOrEqual(0);
      expect(binEnd).toBeLessThan(numLinearBins);
      expect(weightStart).toBeGreaterThanOrEqual(0);
      expect(weightStart).toBeLessThanOrEqual(1);
      expect(weightEnd).toBeGreaterThanOrEqual(0);
      expect(weightEnd).toBeLessThanOrEqual(1);
    }
  });

  it("handles high sample rate (96000Hz) with 4096 FFT", () => {
    const fftSize = 4096;
    const numBands = 512;
    const result = computeBandMappings("log", numBands, 96000, fftSize);
    const numLinearBins = fftSize / 2 + 1;

    expect(result.length).toBe(numBands * 4);

    for (let band = 0; band < numBands; band++) {
      const offset = band * 4;

      expect(result[offset]!).toBeGreaterThanOrEqual(0);
      expect(result[offset + 1]!).toBeLessThan(numLinearBins);
      expect(result[offset + 2]!).toBeGreaterThanOrEqual(0);
      expect(result[offset + 2]!).toBeLessThanOrEqual(1);
      expect(result[offset + 3]!).toBeGreaterThanOrEqual(0);
      expect(result[offset + 3]!).toBeLessThanOrEqual(1);
    }
  });

  it("handles small band count (1 band)", () => {
    const result = computeBandMappings("log", 1, 44100, 4096);

    expect(result.length).toBe(1 * 4);
    expect(result[0]!).toBeGreaterThanOrEqual(0);
    expect(result[1]!).toBeLessThan(4096 / 2 + 1);
    expect(result[2]!).toBeGreaterThanOrEqual(0);
    expect(result[2]!).toBeLessThanOrEqual(1);
    expect(result[3]!).toBeGreaterThanOrEqual(0);
    expect(result[3]!).toBeLessThanOrEqual(1);
  });

  it("handles small band count (2 bands)", () => {
    const result = computeBandMappings("log", 2, 44100, 4096);

    expect(result.length).toBe(2 * 4);

    for (let band = 0; band < 2; band++) {
      const offset = band * 4;

      expect(result[offset]!).toBeGreaterThanOrEqual(0);
      expect(result[offset + 1]!).toBeLessThan(4096 / 2 + 1);
      expect(result[offset + 2]!).toBeGreaterThanOrEqual(0);
      expect(result[offset + 2]!).toBeLessThanOrEqual(1);
      expect(result[offset + 3]!).toBeGreaterThanOrEqual(0);
      expect(result[offset + 3]!).toBeLessThanOrEqual(1);
    }
  });

  it("handles numBands exceeding linear bin count", () => {
    const fftSize = 256;
    const numBands = 4096;
    const numLinearBins = fftSize / 2 + 1; // 129
    const result = computeBandMappings("log", numBands, 44100, fftSize);

    expect(result.length).toBe(numBands * 4);

    for (let band = 0; band < numBands; band++) {
      const offset = band * 4;
      const binStart = result[offset]!;
      const binEnd = result[offset + 1]!;

      expect(binStart).toBeGreaterThanOrEqual(0);
      expect(binEnd).toBeLessThan(numLinearBins);
      expect(result[offset + 2]!).toBeGreaterThanOrEqual(0);
      expect(result[offset + 2]!).toBeLessThanOrEqual(1);
      expect(result[offset + 3]!).toBeGreaterThanOrEqual(0);
      expect(result[offset + 3]!).toBeLessThanOrEqual(1);
    }
  });

  it("returns empty array for linear scale regardless of parameters", () => {
    expect(computeBandMappings("linear", 1, 96000, 256).length).toBe(0);
    expect(computeBandMappings("linear", 4096, 44100, 4096).length).toBe(0);
  });
});
