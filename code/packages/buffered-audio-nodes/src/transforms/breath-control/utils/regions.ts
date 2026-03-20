export interface Region {
	start: number;
	end: number;
}

export function findRegions(mask: Uint8Array, minDuration: number, length: number): Array<Region> {
	const regions: Array<Region> = [];
	let regionStart = -1;

	for (let index = 0; index <= length; index++) {
		const active = index < length && (mask[index] ?? 0) > 0;

		if (active && regionStart === -1) {
			regionStart = index;
		} else if (!active && regionStart !== -1) {
			if (index - regionStart >= minDuration) {
				regions.push({ start: regionStart, end: index });
			}

			regionStart = -1;
		}
	}

	return regions;
}
