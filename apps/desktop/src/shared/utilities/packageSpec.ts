export function packageNameFromSpec(packageSpec: string): string {
	const trimmed = packageSpec.trim();

	if (trimmed.startsWith("@")) {
		const scopeSlashIndex = trimmed.indexOf("/");

		if (scopeSlashIndex === -1) {
			return trimmed;
		}

		const versionSeparatorIndex = trimmed.indexOf("@", scopeSlashIndex + 1);

		return versionSeparatorIndex === -1 ? trimmed : trimmed.slice(0, versionSeparatorIndex);
	}

	const versionSeparatorIndex = trimmed.indexOf("@");

	return versionSeparatorIndex === -1 ? trimmed : trimmed.slice(0, versionSeparatorIndex);
}

export function packageSpecFromNameAndVersion(packageName: string, packageVersion: string): string {
	return `${packageName}@${packageVersion}`;
}
