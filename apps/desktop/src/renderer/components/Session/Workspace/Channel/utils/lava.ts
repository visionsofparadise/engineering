const CONTROL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
	[0, 0, 0],
	[5, 5, 30],
	[15, 20, 70],
	[30, 15, 50],
	[80, 10, 5],
	[140, 20, 0],
	[185, 55, 0],
	[215, 100, 5],
	[240, 155, 25],
	[252, 210, 70],
	[255, 240, 140],
	[255, 255, 255],
];

function lerp(from: number, to: number, factor: number): number {
	return from + (to - from) * factor;
}

export function lavaColor(normalized: number): readonly [number, number, number] {
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
