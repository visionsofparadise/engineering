import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { build } from "esbuild";
import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { BUNDLE_PACKAGE_ACTION, type BundlePackageInput, type BundlePackageIpcParameters, type BundlePackageIpcReturn } from "./Renderer";

const execFileAsync = promisify(execFile);

export class BundlePackageMainIpc extends AsyncMainIpc<BundlePackageIpcParameters, BundlePackageIpcReturn> {
	action = BUNDLE_PACKAGE_ACTION;

	async handler(input: BundlePackageInput, _dependencies: IpcHandlerDependencies): Promise<BundlePackageIpcReturn> {
		const raw = await readFile(join(input.sourceDirectory, "package.json"), "utf-8");
		const packageJson = JSON.parse(raw) as { module?: string; main?: string };
		const entryPoint = packageJson.module ?? packageJson.main ?? "src/index.ts";

		const nodeModulesExists = await stat(join(input.sourceDirectory, "node_modules")).catch(() => null);

		if (!nodeModulesExists) {
			const npmCli = join(require.resolve("npm/package.json"), "..", "bin", "npm-cli.js");

			await execFileAsync(process.execPath, [npmCli, "install", "--omit=dev"], {
				cwd: input.sourceDirectory,
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
			});
		}

		await build({
			entryPoints: [join(input.sourceDirectory, entryPoint)],
			bundle: true,
			format: "esm",
			platform: "node",
			outfile: input.outputPath,
			external: [],
		});

		return undefined;
	}
}
