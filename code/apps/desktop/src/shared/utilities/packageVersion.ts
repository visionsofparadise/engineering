export function getPackageVersion(
	packages: ReadonlyArray<{ name?: string; version?: string }>,
	packageName: string,
): string {
	const entry = packages.find((p) => p.name === packageName);

	if (!entry) {
		throw new Error(`Package "${packageName}" not found in loaded packages`);
	}

	if (!entry.version) {
		throw new Error(`Package "${packageName}" has no version`);
	}

	return entry.version;
}
