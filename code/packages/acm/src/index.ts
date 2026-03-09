/* eslint-disable barrel-files/avoid-barrel-files */
// Types
export type { AudioChunk, RenderOptions, StreamContext } from "./module";

// Base classes
export { ChunkBuffer, type BufferStorage } from "./chunk-buffer";
export { FfmpegModule as FfmpegModule, type FfmpegProperties as FfmpegTransformProperties } from "./ffmpeg";
export { AudioChainModule, type AudioChainModuleInput, type AudioChainModuleProperties } from "./module";
export { SourceModule, type RenderTiming, type SourceModuleProperties } from "./source";
export { TargetModule, type TargetModuleProperties } from "./target";
export { TransformModule, type TransformModuleProperties, type TransformTiming } from "./transform";

// Composition
export { chain } from "./composites/chain";
export { fan, FanTransform, type FanTransformProperties } from "./composites/fan";

// Concrete modules
export { read, ReadModule, type ReadProperties } from "./sources/read";
export { write, WriteModule, type WavBitDepth, type WriteProperties } from "./targets/write";
export { ffmpeg, FfmpegCommandModule as FfmpegTransform, type FfmpegCommandModuleProperties as FfmpegProperties } from "./transforms/ffmpeg-command";
export { loudness, LoudnessModule as LoudnessTransformModule, type LoudnessProperties } from "./transforms/loudness";
export { normalize, NormalizeModule as NormalizeTransformModule, type NormalizeProperties } from "./transforms/normalize";
export { cut, CutModule, type CutProperties, type CutRegion } from "./transforms/cut";
export { pad, PadModule as PadTransformModule, type PadProperties } from "./transforms/pad";
export { pitchShift, PitchShiftModule as PitchShiftTransformModule, type PitchShiftProperties } from "./transforms/pitch-shift";
export { resample, ResampleModule as ResampleTransformModule, type ResampleProperties } from "./transforms/resample";
export { reverse, ReverseModule } from "./transforms/reverse";
export { timeStretch, TimeStretchModule as TimeStretchTransformModule, type TimeStretchProperties } from "./transforms/time-stretch";
export { trim, TrimModule, type TrimProperties } from "./transforms/trim";

export { breathControl, BreathControlModule as BreathControlTransformModule, type BreathControlProperties } from "./transforms/breath-control";
export { deBleed, DeBleedModule as DeBleedTransformModule, type DeBleedProperties } from "./transforms/de-bleed";
export { deCrackle, deClick, DeClickModule as DeClickTransformModule, mouthDeClick, type DeClickProperties } from "./transforms/de-click";
export { deClip, DeClipModule as DeClipTransformModule, type DeClipProperties } from "./transforms/de-clip";
export { dePlosive, DePlosiveModule as DePlosiveTransformModule, type DePlosiveProperties } from "./transforms/de-plosive";
export { deReverb, DeReverbModule as DeReverbTransformModule, type DeReverbProperties } from "./transforms/de-reverb";
export { dither, DitherModule as DitherTransformModule, type DitherProperties } from "./transforms/dither";
export { eqMatch, EqMatchModule as EqMatchTransformModule, type EqMatchProperties } from "./transforms/eq-match";
export { leveler, LevelerModule as LevelerTransformModule, type LevelerProperties } from "./transforms/leveler";
export { loudnessStats, LoudnessStatsModule as LoudnessStatsTransformModule, type LoudnessStats } from "./transforms/loudness-stats";
export { dialogueIsolate, musicRebalance, MusicRebalanceModule as MusicRebalanceTransformModule, type MusicRebalanceProperties, type StemGains } from "./transforms/music-rebalance";
export { invert, phase, PhaseModule as PhaseTransformModule, type PhaseProperties } from "./transforms/phase";
export { spectralRepair, SpectralRepairModule as SpectralRepairTransformModule, type SpectralRegion, type SpectralRepairProperties } from "./transforms/spectral-repair";
export { voiceDenoise, VoiceDenoiseModule as VoiceDenoiseTransformModule, type VoiceDenoiseProperties } from "./transforms/voice-denoise";

// Utilities
export { dbToLinear } from "./utils/db";
export { createOnnxSession, type OnnxSession, type OnnxTensor } from "./utils/onnx-runtime";
export { readToBuffer, type ReadToBufferResult } from "./utils/read-to-buffer";
export { resolveBinary } from "./utils/resolve-binary";
export { istft, stft, type StftResult } from "./utils/stft";
