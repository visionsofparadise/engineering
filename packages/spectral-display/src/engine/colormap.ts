import { lavaColormap } from "../utils/lava";
import { viridisColormap } from "../utils/viridis";

export interface ColormapDefinition {
	colors: ReadonlyArray<{
		position: number;
		color: readonly [number, number, number];
	}>;
}

export function generateColormapBuffer(definition: ColormapDefinition): Uint8Array {
	const buffer = new Uint8Array(256 * 4);
	const { colors } = definition;

	for (let index = 0; index < 256; index++) {
		const position = index / 255;

		let lowerIndex = 0;

		for (let ci = 0; ci < colors.length - 1; ci++) {
			const entry = colors[ci];

			if (entry && entry.position <= position) {
				lowerIndex = ci;
			}
		}

		const lower = colors[lowerIndex];
		const upper = colors[Math.min(lowerIndex + 1, colors.length - 1)];

		if (!lower || !upper) {
			continue;
		}

		const range = upper.position - lower.position;
		const interpolation = range === 0 ? 0 : (position - lower.position) / range;
		const clamped = Math.max(0, Math.min(1, interpolation));

		const offset = index * 4;

		buffer[offset] = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * clamped);
		buffer[offset + 1] = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * clamped);
		buffer[offset + 2] = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * clamped);
		buffer[offset + 3] = 255;
	}

	return buffer;
}

export function resolveColormap(colormap: "lava" | "viridis" | ColormapDefinition): ColormapDefinition {
	if (colormap === "lava") {
		return lavaColormap;
	}

	if (colormap === "viridis") {
		return viridisColormap;
	}

	return colormap;
}

export function resolveWaveformColor(colormap: "lava" | "viridis" | ColormapDefinition, override?: [number, number, number]): [number, number, number] {
	if (override) {
		return override;
	}

	if (colormap === "lava") {
		return [40, 135, 180];
	}

	if (colormap === "viridis") {
		return [180, 115, 42];
	}

	return [200, 200, 200];
}
