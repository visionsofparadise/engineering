const CONTROL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
	[68, 1, 84],
	[72, 35, 116],
	[64, 68, 135],
	[52, 96, 141],
	[33, 137, 136],
	[26, 158, 123],
	[42, 182, 91],
	[118, 191, 47],
	[168, 186, 35],
];

function lerp(from: number, to: number, factor: number): number {
	return from + (to - from) * factor;
}

export function viridisColor(normalized: number): readonly [number, number, number] {
	const clamped = Math.max(0, Math.min(1, normalized));
	const segments = CONTROL_POINTS.length - 1;
	const scaled = clamped * segments;
	const index = Math.min(Math.floor(scaled), segments - 1);
	const factor = scaled - index;

	const lo = CONTROL_POINTS[index];
	const hi = CONTROL_POINTS[index + 1];
	if (!lo || !hi) return [0, 0, 0];

	return [
		Math.round(lerp(lo[0], hi[0], factor)),
		Math.round(lerp(lo[1], hi[1], factor)),
		Math.round(lerp(lo[2], hi[2], factor)),
	];
}
