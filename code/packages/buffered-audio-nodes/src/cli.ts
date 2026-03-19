import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGraph, type NodeRegistry } from "./executor";
import { validateGraphDefinition } from "./graph-format";
import type { BufferedAudioNode } from "./node";
import { SourceNode } from "./sources";

const program = new Command();

program.name("buffered-audio-nodes").description("Process audio through buffered audio node pipelines");

program
	.command("process")
	.description("Run an async audio processing pipeline")
	.requiredOption("--pipeline <file>", "TypeScript file with default SourceAsyncModule export")
	.option("--chunk-size <samples>", "Chunk size in samples")
	.option("--high-water-mark <count>", "Stream backpressure high water mark")
	.action(async (options: { pipeline: string; chunkSize?: string; highWaterMark?: string }) => {
		const pipelinePath = resolve(options.pipeline);

		if (!existsSync(pipelinePath)) {
			process.stderr.write(`Error: pipeline file not found: ${pipelinePath}\n`);
			process.exit(1);
		}

		const { register } = await import("tsx/esm/api");
		const unregister = register();

		try {
			const mod = (await import(pipelinePath)) as Record<string, unknown>;
			const source = mod.default;

			if (!(source instanceof SourceNode)) {
				process.stderr.write("Error: default export must be a SourceAsyncModule\n");
				process.exit(1);
			}

			const chunkSize = options.chunkSize ? parseInt(options.chunkSize, 10) : undefined;
			const highWaterMark = options.highWaterMark ? parseInt(options.highWaterMark, 10) : undefined;

			if (chunkSize !== undefined && (!Number.isFinite(chunkSize) || chunkSize <= 0)) {
				process.stderr.write(`Error: --chunk-size must be a positive integer, got "${options.chunkSize}"\n`);
				process.exit(1);
			}

			if (highWaterMark !== undefined && (!Number.isFinite(highWaterMark) || highWaterMark <= 0)) {
				process.stderr.write(`Error: --high-water-mark must be a positive integer, got "${options.highWaterMark}"\n`);
				process.exit(1);
			}

			const renderOptions = {
				chunkSize,
				highWaterMark,
			};

			process.stdout.write(`Processing pipeline: ${pipelinePath}\n`);
			await source.render(renderOptions);
			process.stdout.write("Done.\n");
		} finally {
			await unregister();
		}
	});

program
	.command("render")
	.description("Render a .bag graph definition file")
	.argument("<file>", "Path to .bag file (JSON)")
	.option("--chunk-size <samples>", "Chunk size in samples")
	.option("--high-water-mark <count>", "Stream backpressure high water mark")
	.action(async (file: string, options: { chunkSize?: string; highWaterMark?: string }) => {
		const bagPath = resolve(file);

		if (!existsSync(bagPath)) {
			process.stderr.write(`Error: file not found: ${bagPath}\n`);
			process.exit(1);
		}

		const json = JSON.parse(readFileSync(bagPath, "utf-8")) as unknown;
		const definition = validateGraphDefinition(json);

		const { register } = await import("tsx/esm/api");
		const unregister = register();

		try {
			const registry: NodeRegistry = new Map();

			for (const nodeDef of definition.nodes) {
				if (!registry.has(nodeDef.package)) {
					const mod = (await import(nodeDef.package)) as Record<string, unknown>;
					const packageMap = new Map<string, new (options?: Record<string, unknown>) => BufferedAudioNode>();

					for (const [key, value] of Object.entries(mod)) {
						if (typeof value === "function") {
							packageMap.set(key, value as new (options?: Record<string, unknown>) => BufferedAudioNode);
						}
					}

					registry.set(nodeDef.package, packageMap);
				}
			}

			const chunkSize = options.chunkSize ? parseInt(options.chunkSize, 10) : undefined;
			const highWaterMark = options.highWaterMark ? parseInt(options.highWaterMark, 10) : undefined;

			process.stdout.write(`Rendering graph: ${definition.name}\n`);
			await renderGraph(definition, registry, { chunkSize, highWaterMark });
			process.stdout.write("Done.\n");
		} finally {
			await unregister();
		}
	});

program.parse();
