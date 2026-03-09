import { execFile } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function resolveBinary(name: string, providedPath?: string): Promise<string> {
	if (providedPath) {
		await assertExecutable(providedPath);
		return providedPath;
	}

	const envKey = `${name.toUpperCase()}_PATH`;
	const envPath = process.env[envKey];

	if (envPath) {
		await assertExecutable(envPath);
		return envPath;
	}

	return lookupPath(name);
}

async function assertExecutable(path: string): Promise<void> {
	await access(path, constants.X_OK);
}

async function lookupPath(name: string): Promise<string> {
	const command = process.platform === "win32" ? "where" : "which";

	try {
		const { stdout } = await execFileAsync(command, [name]);
		const resolved = stdout.trim().split(/\r?\n/)[0];

		if (!resolved) {
			throw new Error();
		}

		return resolved;
	} catch {
		throw new Error(`Binary "${name}" not found. Provide a path via the unit's binaryPath property or set the ${name.toUpperCase()}_PATH environment variable.`);
	}
}
