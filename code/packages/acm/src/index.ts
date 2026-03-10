/* eslint-disable barrel-files/avoid-barrel-files */
// Types
export type { AudioChunk, ModuleEventMap, ModuleSchema, RenderOptions, StreamContext } from "./module";

// Base classes
export { ChunkBuffer, type BufferStorage } from "./chunk-buffer";
export { AudioChainModule, type AudioChainModuleInput, type AudioChainModuleProperties } from "./module";
export { SourceModule, type RenderTiming, type SourceModuleProperties } from "./source";
export { TargetModule, type TargetModuleProperties } from "./target";
export { TransformModule, type TransformModuleProperties, type TransformTiming } from "./transform";
export { ffmpeg, FfmpegModule, FfmpegModule as FfmpegTransform, type FfmpegProperties, type FfmpegProperties as FfmpegTransformProperties } from "./transforms/ffmpeg";

// Composition
export { chain } from "./composites/chain";
export { fan, FanTransform, type FanTransformProperties } from "./composites/fan";

// Chain format
export { validateChainDefinition, type ChainDefinition, type ChainModuleReference } from "./chain-format";

// Concrete modules
export { read, ReadModule, type ReadProperties } from "./sources/read";
export { write, WriteModule, type EncodingOptions, type WavBitDepth, type WriteProperties } from "./targets/write";
export { cut, CutModule, type CutProperties, type CutRegion } from "./transforms/cut";
export { loudness, LoudnessModule as LoudnessTransformModule, type LoudnessProperties } from "./transforms/loudness";
export { normalize, NormalizeModule as NormalizeTransformModule, type NormalizeProperties } from "./transforms/normalize";
export { pad, PadModule as PadTransformModule, type PadProperties } from "./transforms/pad";
export { pitchShift, PitchShiftModule as PitchShiftTransformModule, type PitchShiftProperties } from "./transforms/pitch-shift";
export { resample, ResampleModule as ResampleTransformModule, type ResampleProperties } from "./transforms/resample";
export { reverse, ReverseModule } from "./transforms/reverse";
export { timeStretch, TimeStretchModule as TimeStretchTransformModule, type TimeStretchProperties } from "./transforms/time-stretch";
export { trim, TrimModule, type TrimProperties } from "./transforms/trim";

export { breathControl, BreathControlModule as BreathControlTransformModule, type BreathControlProperties } from "./transforms/breath-control";
export { deBleed, DeBleedModule as DeBleedTransformModule, type DeBleedProperties } from "./transforms/de-bleed";
export { deClick, schema as deClickSchema, DeClickModule as DeClickTransformModule, type DeClickProperties } from "./transforms/de-click";
export { deCrackle, DeCrackleModule, schema as deCrackleSchema, type DeCrackleProperties } from "./transforms/de-click/de-crackle";
export { mouthDeClick, MouthDeClickModule, mouthDeClickSchema, type MouthDeClickProperties } from "./transforms/de-click/mouth-de-click";
export { deClip, DeClipModule as DeClipTransformModule, type DeClipProperties } from "./transforms/de-clip";
export { dePlosive, DePlosiveModule as DePlosiveTransformModule, type DePlosiveProperties } from "./transforms/de-plosive";
export { deReverb, DeReverbModule as DeReverbTransformModule, type DeReverbProperties } from "./transforms/de-reverb";
export { dialogueIsolate, DialogueIsolateModule as DialogueIsolateTransformModule, type DialogueIsolateProperties } from "./transforms/dialogue-isolate";
export { dither, DitherModule as DitherTransformModule, type DitherProperties } from "./transforms/dither";
export { eqMatch, EqMatchModule as EqMatchTransformModule, type EqMatchProperties } from "./transforms/eq-match";
export { leveler, LevelerModule as LevelerTransformModule, type LevelerProperties } from "./transforms/leveler";
export { loudnessStats, LoudnessStatsModule as LoudnessStatsTransformModule, type LoudnessStats } from "./transforms/loudness-stats";
export { musicRebalance, MusicRebalanceModule as MusicRebalanceTransformModule, type MusicRebalanceProperties, type StemGains } from "./transforms/music-rebalance";
export { invert, phase, PhaseModule as PhaseTransformModule, type PhaseProperties } from "./transforms/phase";
export { spectralRepair, SpectralRepairModule as SpectralRepairTransformModule, type SpectralRegion, type SpectralRepairProperties } from "./transforms/spectral-repair";
export { spectrogram, SpectrogramModule as SpectrogramTransformModule, type SpectrogramProperties } from "./transforms/spectrogram";
export { splice, SpliceModule as SpliceTransformModule, type SpliceProperties } from "./transforms/splice";
export { voiceDenoise, VoiceDenoiseModule as VoiceDenoiseTransformModule, type VoiceDenoiseProperties } from "./transforms/voice-denoise";
export { waveform, WaveformModule as WaveformTransformModule, type WaveformProperties } from "./transforms/waveform";

// Utilities
export { applyTransform } from "./utils/apply-transform";
export { biquadFilter, highPassCoefficients, lowPassCoefficients, preFilterCoefficients, rlbFilterCoefficients, zeroPhaseBiquadFilter, type BiquadCoefficients } from "./utils/biquad";
export { dbToLinear, linearToDb } from "./utils/db";
export { createOnnxSession, type OnnxSession, type OnnxTensor } from "./utils/onnx-runtime";
export { readToBuffer, type ReadToBufferResult } from "./utils/read-to-buffer";
export { resolveBinary } from "./utils/resolve-binary";
export { bitReverse, butterflyStages, createFftWorkspace, fft, hanningWindow, ifft, istft, stft, type FftWorkspace, type StftOutput, type StftResult } from "./utils/stft";
