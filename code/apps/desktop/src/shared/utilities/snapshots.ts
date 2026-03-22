export function getSnapshotDir(userDataPath: string, hash: string): string {
	return `${userDataPath}/snapshots/${hash}`;
}

export function getSnapshotPaths(
	userDataPath: string,
	hash: string,
): { audio: string; waveform: string; spectrogram: string } {
	const dir = getSnapshotDir(userDataPath, hash);

	return {
		audio: `${dir}/audio.wav`,
		waveform: `${dir}/waveform.bin`,
		spectrogram: `${dir}/spectrogram.bin`,
	};
}

export async function hasSnapshot(userDataPath: string, hash: string): Promise<boolean> {
	try {
		const result = await window.main.stat(getSnapshotDir(userDataPath, hash));

		return result !== null;
	} catch {
		return false;
	}
}
