import { createHash } from "node:crypto";

const sortKeysRecursively = (value: unknown): unknown => {
	if (value === null || typeof value !== "object") {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map(sortKeysRecursively);
	}

	const sorted: Record<string, unknown> = {};

	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		sorted[key] = sortKeysRecursively((value as Record<string, unknown>)[key]);
	}

	return sorted;
};

export const contentHash = (
	upstreamHash: string,
	packageName: string,
	packageVersion: string,
	nodeName: string,
	parameters: Record<string, unknown>,
	bypass: boolean,
): string => {
	const payload = JSON.stringify([
		upstreamHash,
		packageName,
		packageVersion,
		nodeName,
		sortKeysRecursively(parameters),
		bypass,
	]);

	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
};
