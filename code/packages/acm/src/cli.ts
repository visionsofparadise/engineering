import { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SourceModule } from "./source";

const program = new Command();

program.name("engineering-acm").description("Process audio through async module pipelines");

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

			if (!(source instanceof SourceModule)) {
				process.stderr.write("Error: default export must be a SourceAsyncModule\n");
				process.exit(1);
			}

			const renderOptions = {
				chunkSize: options.chunkSize ? Number(options.chunkSize) : undefined,
				highWaterMark: options.highWaterMark ? Number(options.highWaterMark) : undefined,
			};

			process.stdout.write(`Processing pipeline: ${pipelinePath}\n`);
			await source.render(renderOptions);
			process.stdout.write("Done.\n");
		} finally {
			await unregister();
		}
	});

program.parse();
