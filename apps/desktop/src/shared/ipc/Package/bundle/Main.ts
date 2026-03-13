import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { build } from "esbuild";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { BUNDLE_PACKAGE_ACTION, type BundlePackageInput, type BundlePackageIpcParameters, type BundlePackageIpcReturn } from "./Renderer";

export class BundlePackageMainIpc extends AsyncMainIpc<BundlePackageIpcParameters, BundlePackageIpcReturn> {
	action = BUNDLE_PACKAGE_ACTION;

	async handler(input: BundlePackageInput, _dependencies: IpcHandlerDependencies): Promise<BundlePackageIpcReturn> {
		const raw = await readFile(join(input.sourceDirectory, "package.json"), "utf-8");
		const packageJson = JSON.parse(raw) as { module?: string; main?: string };
		const entryPoint = packageJson.module ?? packageJson.main ?? "src/index.ts";

		await build({
			entryPoints: [join(input.sourceDirectory, entryPoint)],
			bundle: true,
			format: "esm",
			platform: "node",
			outfile: input.outputPath,
			external: ["audio-chain-module"],
		});

		return undefined;
	}
}
