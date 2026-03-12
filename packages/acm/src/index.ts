/* eslint-disable barrel-files/avoid-barrel-files */
// Types
export type { AudioChunk, ExecutionProvider, ModuleEventMap, ModuleSchema, RenderOptions, StreamContext, StreamMeta } from "./module";

// Base classes
export { ChunkBuffer, type BufferStorage } from "./chunk-buffer";
export { AudioChainModule, type AudioChainModuleInput, type AudioChainModuleProperties } from "./module";
export { SourceModule, type RenderTiming, type SourceModuleProperties } from "./source";
export { TargetModule, type TargetModuleProperties } from "./target";
export { TransformModule, type TransformModuleProperties, type TransformTiming } from "./transform";

// Composition
export { chain } from "./composites/chain";
export { fan, FanTransform, type FanTransformProperties } from "./composites/fan";

// Chain format
export { validateChainDefinition, type ChainDefinition, type ChainModuleReference } from "./chain-format";

// Concrete modules
export { read, ReadModule, type ReadProperties } from "./sources/read";
export { write, WriteModule, type WavBitDepth, type WriteProperties } from "./targets/write";
export { cut, CutModule, type CutProperties, type CutRegion } from "./transforms/cut";
export { dither, DitherModule as DitherTransformModule, type DitherProperties } from "./transforms/dither";
export { normalize, NormalizeModule as NormalizeTransformModule, type NormalizeProperties } from "./transforms/normalize";
export { pad, PadModule as PadTransformModule, type PadProperties } from "./transforms/pad";
export { invert, phase, PhaseModule as PhaseTransformModule, type PhaseProperties } from "./transforms/phase";
export { reverse, ReverseModule } from "./transforms/reverse";
export { splice, SpliceModule as SpliceTransformModule, type SpliceProperties } from "./transforms/splice";
export { trim, TrimModule, type TrimProperties } from "./transforms/trim";
export { waveform, WaveformModule as WaveformTransformModule, type WaveformProperties } from "./transforms/waveform";

// Utilities
export { dbToLinear, linearToDb } from "./utils/db";
