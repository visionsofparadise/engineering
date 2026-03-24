/* eslint-disable barrel-files/avoid-barrel-files */
export type { FrequencyScale } from "./engine/band-mapping";
export type { ColormapDefinition } from "./engine/colormap";
export type { LoudnessData } from "./engine/loudness";
export type { PipelineOptions, PipelineResult, ResolvedPipelineOptions, SampleQuery, SpectralMetadata } from "./engine/runPipeline";
export type { Dimensions, SpectralConfig } from "./engine/SpectralEngine";
export { LoudnessCanvas } from "./LoudnessCanvas";
export type { LoudnessCanvasProps } from "./LoudnessCanvas";
export { SpectrogramCanvas } from "./SpectrogramCanvas";
export { useSpectralCompute } from "./useSpectralCompute";
export type { ComputeResult, SpectralOptions, SpectralQuery } from "./useSpectralCompute";
export { lavaColormap } from "./utils/lava";
export { viridisColormap } from "./utils/viridis";
export { WaveformCanvas } from "./WaveformCanvas";
