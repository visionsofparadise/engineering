import { createHash } from "node:crypto";

export function sortKeysRecursive(
	record: Record<string, unknown>,
): Record<string, unknown> {
	const sorted: Record<string, unknown> = {};

	for (const key of Object.keys(record).sort()) {
		const value = record[key];

		if (
			value !== null &&
			typeof value === "object" &&
			!Array.isArray(value)
		) {
			sorted[key] = sortKeysRecursive(value as Record<string, unknown>);
		} else {
			sorted[key] = value;
		}
	}

	return sorted;
}

export function contentHash(
	upstreamHash: string,
	packageName: string,
	packageVersion: string,
	nodeName: string,
	parameters: Record<string, unknown>,
	bypass: boolean,
): string {
	const input =
		upstreamHash +
		packageName +
		packageVersion +
		nodeName +
		JSON.stringify(sortKeysRecursive(parameters)) +
		String(bypass);

	return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
