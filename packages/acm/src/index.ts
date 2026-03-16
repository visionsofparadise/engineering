/* eslint-disable barrel-files/avoid-barrel-files */
// Types
export type { AudioChunk, ExecutionProvider, FileInputMeta, ModuleEventMap, ModuleSchema, RenderOptions, StreamContext, StreamMeta } from "./module";

// Base classes
export { ChunkBuffer, type BufferStorage } from "./chunk-buffer";
export { AudioChainModule, type AudioChainModuleInput, type AudioChainModuleProperties } from "./module";
export { SourceModule, type RenderTiming, type SourceModuleProperties } from "./source";
export { TargetModule, type TargetModuleProperties } from "./target";
export { TransformModule, WHOLE_FILE, type TransformModuleProperties, type TransformTiming } from "./transform";

// Composition
export { chain } from "./composites/chain";

// Chain format
export { validateChainDefinition, type ChainDefinition, type ChainModuleReference } from "./chain-format";

// Sources
export { read, ReadModule, type ReadProperties } from "./sources/read";

// Targets
export { write, WriteModule, type WavBitDepth, type WriteProperties, type EncodingOptions } from "./targets/write";

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
export { ffmpeg, FfmpegModule, type FfmpegProperties } from "./transforms/ffmpeg";
export { resample, ResampleModule, type ResampleProperties } from "./transforms/resample";
export { loudness, LoudnessModule, type LoudnessProperties } from "./transforms/loudness";
export { loudnessStats, LoudnessStatsModule, type LoudnessStats } from "./transforms/loudness-stats";
export { spectrogram, SpectrogramModule, type SpectrogramProperties, type FrequencyScale } from "./transforms/spectrogram";

// Transforms - engineering
export { breathControl, BreathControlModule, type BreathControlProperties } from "./transforms/breath-control";
export { deBleed, DeBleedModule, type DeBleedProperties } from "./transforms/de-bleed";
export { deClick, DeClickModule, type DeClickProperties } from "./transforms/de-click";
export { deCrackle, DeCrackleModule, type DeCrackleProperties } from "./transforms/de-click/de-crackle";
export { mouthDeClick, MouthDeClickModule, type MouthDeClickProperties } from "./transforms/de-click/mouth-de-click";
export { deClip, DeClipModule, type DeClipProperties } from "./transforms/de-clip";
export { dePlosive, DePlosiveModule, type DePlosiveProperties } from "./transforms/de-plosive";
export { deReverb, DeReverbModule, type DeReverbProperties } from "./transforms/de-reverb";
export { dialogueIsolate, DialogueIsolateModule, type DialogueIsolateProperties } from "./transforms/dialogue-isolate";
export { eqMatch, EqMatchModule, type EqMatchProperties } from "./transforms/eq-match";
export { leveler, LevelerModule, type LevelerProperties } from "./transforms/leveler";
export { musicRebalance, MusicRebalanceModule, type MusicRebalanceProperties, type StemGains } from "./transforms/music-rebalance";
export { pitchShift, PitchShiftModule, type PitchShiftProperties } from "./transforms/pitch-shift";
export { spectralRepair, SpectralRepairModule, type SpectralRegion, type SpectralRepairProperties } from "./transforms/spectral-repair";
export { timeStretch, TimeStretchModule, type TimeStretchProperties } from "./transforms/time-stretch";
export { voiceDenoise, VoiceDenoiseModule, type VoiceDenoiseProperties } from "./transforms/voice-denoise";

// Utilities
export { dbToLinear, linearToDb } from "./utils/db";
