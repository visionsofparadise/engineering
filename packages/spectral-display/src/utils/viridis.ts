import type { ColormapDefinition } from "../engine/colormap";

const controlPoints: ReadonlyArray<readonly [number, number, number]> = [
  [68, 1, 84],
  [72, 35, 116],
  [64, 68, 135],
  [52, 96, 141],
  [33, 137, 136],
  [26, 158, 123],
  [42, 182, 91],
  [118, 191, 47],
  [168, 186, 35],
  [208, 200, 29],
  [240, 218, 28],
  [253, 231, 37],
];

export const viridisColormap: ColormapDefinition = {
  colors: controlPoints.map((color, index) => ({
    position: index / (controlPoints.length - 1),
    color,
  })),
};
