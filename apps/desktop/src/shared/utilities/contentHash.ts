import { createHash } from "node:crypto";
import { sortKeysRecursive } from "./sortKeysRecursive";

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
