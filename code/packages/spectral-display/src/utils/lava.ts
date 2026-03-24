import type { ColormapDefinition } from "../engine/colormap";

const controlPoints: ReadonlyArray<readonly [number, number, number]> = [
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

export const lavaColormap: ColormapDefinition = {
  colors: controlPoints.map((color, index) => ({
    position: index / (controlPoints.length - 1),
    color,
  })),
};
