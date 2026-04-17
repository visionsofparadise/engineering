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
