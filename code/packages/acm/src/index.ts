/* eslint-disable barrel-files/avoid-barrel-files */
// Types
export type { AudioChunk, ExecutionProvider, FileInputMeta, ModuleEventMap, ModuleSchema, RenderOptions, StreamContext, StreamMeta } from "./module";

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

// Sources
export { read, ReadModule, type ReadProperties } from "./sources/read";
export { TranscodeReadModule, type TranscodeReadProperties } from "./sources/transcode-read";

// Targets
export { write, WriteModule, type WavBitDepth, type WriteProperties } from "./targets/write";
export { TranscodeWriteModule, type TranscodeWriteProperties, type EncodingOptions } from "./targets/transcode-write";

// Transforms - basic
export { cut, CutModule, type CutProperties, type CutRegion } from "./transforms/cut";
export { dither, DitherModule as DitherTransformModule, type DitherProperties } from "./transforms/dither";
export { normalize, NormalizeModule as NormalizeTransformModule, type NormalizeProperties } from "./transforms/normalize";
export { pad, PadModule as PadTransformModule, type PadProperties } from "./transforms/pad";
export { invert, phase, PhaseModule as PhaseTransformModule, type PhaseProperties } from "./transforms/phase";
export { reverse, ReverseModule } from "./transforms/reverse";
export { splice, SpliceModule as SpliceTransformModule, type SpliceProperties } from "./transforms/splice";
export { trim, TrimModule, type TrimProperties } from "./transforms/trim";
export { waveform, WaveformModule as WaveformTransformModule, type WaveformProperties } from "./transforms/waveform";

// Transforms - ffmpeg-based
export { FfmpegModule, type FfmpegProperties } from "./transforms/ffmpeg";
export { ResampleModule, type ResampleProperties } from "./transforms/resample";
export { LoudnessModule, type LoudnessProperties } from "./transforms/loudness";
export { LoudnessStatsModule, type LoudnessStats } from "./transforms/loudness-stats";
export { SpectrogramModule, type SpectrogramProperties, type FrequencyScale } from "./transforms/spectrogram";

// Transforms - engineering
export { BreathControlModule, type BreathControlProperties } from "./transforms/breath-control";
export { DeBleedModule, type DeBleedProperties } from "./transforms/de-bleed";
export { DeClickModule, type DeClickProperties } from "./transforms/de-click";
export { DeCrackleModule, type DeCrackleProperties } from "./transforms/de-click/de-crackle";
export { MouthDeClickModule, type MouthDeClickProperties } from "./transforms/de-click/mouth-de-click";
export { DeClipModule, type DeClipProperties } from "./transforms/de-clip";
export { DePlosiveModule, type DePlosiveProperties } from "./transforms/de-plosive";
export { DeReverbModule, type DeReverbProperties } from "./transforms/de-reverb";
export { DialogueIsolateModule, type DialogueIsolateProperties } from "./transforms/dialogue-isolate";
export { EqMatchModule, type EqMatchProperties } from "./transforms/eq-match";
export { LevelerModule, type LevelerProperties } from "./transforms/leveler";
export { MusicRebalanceModule, type MusicRebalanceProperties, type StemGains } from "./transforms/music-rebalance";
export { PitchShiftModule, type PitchShiftProperties } from "./transforms/pitch-shift";
export { SpectralRepairModule, type SpectralRegion, type SpectralRepairProperties } from "./transforms/spectral-repair";
export { TimeStretchModule, type TimeStretchProperties } from "./transforms/time-stretch";
export { VoiceDenoiseModule, type VoiceDenoiseProperties } from "./transforms/voice-denoise";

// Utilities
export { dbToLinear, linearToDb } from "./utils/db";
export { initOnnxRuntime } from "./utils/onnx-runtime";
export { initFftBackend } from "./utils/fft-backend";
