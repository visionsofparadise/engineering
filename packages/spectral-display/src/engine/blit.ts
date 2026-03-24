import { BLIT_FRAGMENT_SHADER, BLIT_VERTEX_SHADER } from "./shaders";

export class BlitRenderer {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly pipeline: GPURenderPipeline;
  private readonly sampler: GPUSampler;
  private canvasFormat: GPUTextureFormat;

  constructor(device: GPUDevice, canvas: HTMLCanvasElement) {
    this.device = device;

    const context = canvas.getContext("webgpu");

    if (!context) {
      throw new Error("Failed to get WebGPU canvas context");
    }

    this.context = context;
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();

    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "premultiplied",
    });

    this.sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });

    const vertexModule = device.createShaderModule({ code: BLIT_VERTEX_SHADER });
    const fragmentModule = device.createShaderModule({ code: BLIT_FRAGMENT_SHADER });

    this.pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: vertexModule,
        entryPoint: "main",
      },
      fragment: {
        module: fragmentModule,
        entryPoint: "main",
        targets: [{ format: this.canvasFormat }],
      },
      primitive: {
        topology: "triangle-list",
      },
    });
  }

  render(texture: GPUTexture): void {
    const textureView = texture.createView();

    const bindGroup = this.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: textureView },
        { binding: 1, resource: this.sampler },
      ],
    });

    const commandEncoder = this.device.createCommandEncoder();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear" as const,
          storeOp: "store" as const,
        },
      ],
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setBindGroup(0, bindGroup);
    renderPass.draw(6);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  resize(width: number, height: number): void {
    const canvas = this.context.canvas as HTMLCanvasElement;

    canvas.width = width;
    canvas.height = height;

    this.context.configure({
      device: this.device,
      format: this.canvasFormat,
      alphaMode: "premultiplied",
    });
  }

  destroy(): void {
    this.context.unconfigure();
  }
}
