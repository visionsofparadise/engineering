import { describe, expect, it } from "vitest";
import { getMaxFftSize } from "./device";

function mockDevice(maxComputeWorkgroupStorageSize: number): GPUDevice {
  return { limits: { maxComputeWorkgroupStorageSize } } as unknown as GPUDevice;
}

describe("getMaxFftSize", () => {
  it("returns 4096 for 32768 bytes of storage", () => {
    expect(getMaxFftSize(mockDevice(32768))).toBe(4096);
  });

  it("returns 2048 for 16384 bytes of storage", () => {
    expect(getMaxFftSize(mockDevice(16384))).toBe(2048);
  });

  it("returns 8192 for 65536 bytes of storage", () => {
    expect(getMaxFftSize(mockDevice(65536))).toBe(8192);
  });

  it("rounds down to nearest power of 2 for non-power-of-2 result", () => {
    // 40000 / 8 = 5000, nearest power of 2 below is 4096
    expect(getMaxFftSize(mockDevice(40000))).toBe(4096);
  });
});
