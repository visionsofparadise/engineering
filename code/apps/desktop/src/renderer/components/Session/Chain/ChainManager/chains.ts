import { type ChainDefinition, validateChainDefinition } from "@engineering/acm";

function getChainsDirectory(userDataPath: string): string {
	return `${userDataPath}/chains`;
}

export async function listChains(userDataPath: string): Promise<Array<{ label: string; filename: string }>> {
	const directory = getChainsDirectory(userDataPath);

	await window.main.ensureDirectory(directory);

	const entries = await window.main.readDirectory(directory);
	const jsonFiles = entries.filter((entry) => entry.endsWith(".json"));

	const chains: Array<{ label: string; filename: string }> = [];

	for (const filename of jsonFiles) {
		try {
			const content = await window.main.readFile(`${directory}/${filename}`);
			const chain = validateChainDefinition(JSON.parse(content));

			chains.push({ label: chain.label ?? filename.replace(".json", ""), filename });
		} catch {
			// Skip invalid files
		}
	}

	return chains.sort((left, right) => left.label.localeCompare(right.label));
}

export async function loadChain(userDataPath: string, filename: string): Promise<ChainDefinition> {
	const directory = getChainsDirectory(userDataPath);
	const content = await window.main.readFile(`${directory}/${filename}`);

	return validateChainDefinition(JSON.parse(content));
}

function sanitizeFilename(label: string): string {
	const sanitized = label
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, "")
		.replace(/[\s]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return sanitized || `chain-${Date.now()}`;
}

export async function saveChain(userDataPath: string, chain: ChainDefinition): Promise<void> {
	const directory = getChainsDirectory(userDataPath);

	await window.main.ensureDirectory(directory);

	const filename = `${sanitizeFilename(chain.label ?? "")}.json`;

	await window.main.writeFile(`${directory}/${filename}`, JSON.stringify(chain, undefined, 2));
}

export async function deleteChain(userDataPath: string, filename: string): Promise<void> {
	const directory = getChainsDirectory(userDataPath);

	await window.main.deleteFile(`${directory}/${filename}`);
}
