let cachedDevicePromise: Promise<GPUDevice> | null = null;

export async function getDevice(provided?: GPUDevice): Promise<GPUDevice> {
  if (provided) {
    void provided.lost.then((info) => {
      console.error(`WebGPU device was lost: ${info.message}`);
    });

    checkSharedMemoryLimit(provided);

    return provided;
  }

  if (cachedDevicePromise) return cachedDevicePromise;

  cachedDevicePromise = createDevice();

  return cachedDevicePromise;
}

async function createDevice(): Promise<GPUDevice> {
  const gpu = navigator.gpu as GPU | undefined;

  if (!gpu) {
    throw new Error("WebGPU is not supported in this browser");
  }

  const adapter = await gpu.requestAdapter();

  if (!adapter) {
    throw new Error("Failed to obtain WebGPU adapter");
  }

  const device = await adapter.requestDevice({
    requiredLimits: {
      maxComputeWorkgroupStorageSize: adapter.limits.maxComputeWorkgroupStorageSize,
    },
  });

  void device.lost.then((info) => {
    console.error(`WebGPU device was lost: ${info.message}`);
    cachedDevicePromise = null;
  });

  checkSharedMemoryLimit(device);

  return device;
}

export function getMaxFftSize(device: GPUDevice): number {
  const maxStorage = device.limits.maxComputeWorkgroupStorageSize;

  // FFT requires fftSize * 2 * 4 bytes (real + imaginary, float32)
  const maxFft = Math.floor(maxStorage / (2 * 4));

  // Round down to nearest power of 2
  return Math.pow(2, Math.floor(Math.log2(maxFft)));
}

function checkSharedMemoryLimit(device: GPUDevice): void {
  const maxStorage = device.limits.maxComputeWorkgroupStorageSize;
  const maxFft = getMaxFftSize(device);

  if (maxStorage < 32768) {
    console.warn(
      `WebGPU device shared memory is ${maxStorage} bytes. ` +
        `FFT size will be clamped to ${maxFft} (max supported by this device).`,
    );
  }
}
