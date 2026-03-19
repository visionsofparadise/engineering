/* eslint-disable barrel-files/avoid-barrel-files */
// Types
export type { AudioChunk, ExecutionProvider, FileInputMeta, ModuleSchema, RenderOptions, StreamContext, StreamMeta } from "./node";

// Base classes
export { ChunkBuffer, type BufferStorage } from "./chunk-buffer";
export { BufferedAudioNode, type BufferedAudioNodeInput, type BufferedAudioNodeProperties } from "./node";
export { SourceNode, BufferedSourceStream, type RenderTiming, type SourceNodeProperties, type SourceStreamEventMap } from "./source";
export { TargetNode, BufferedTargetStream, type TargetNodeProperties, type TargetStreamEventMap } from "./target";
export { TransformNode, BufferedTransformStream, WHOLE_FILE, type TransformNodeProperties, type TransformStreamEventMap } from "./transform";

// Graph format (BAG)
export { validateGraphDefinition, type GraphDefinition, type GraphNode, type GraphEdge } from "./graph-format";

// Graph executor
export { executeGraph, renderGraph, graphDefinitionToNodes, type NodeRegistry } from "./executor";

// Sources
export { read, ReadNode, ReadStream, type ReadProperties } from "./sources/read";

// Targets
export { write, WriteNode, WriteStream, type WavBitDepth, type WriteProperties, type EncodingOptions } from "./targets/write";
export { waveform, WaveformNode, WaveformStream, type WaveformProperties } from "./targets/waveform";
export { spectrogram, SpectrogramNode, SpectrogramStream, type SpectrogramProperties, type FrequencyScale } from "./targets/spectrogram";
export { loudnessStats, LoudnessStatsNode, LoudnessStatsStream, type LoudnessStats } from "./targets/loudness-stats";

// Transforms - basic
export { cut, CutNode, CutStream, type CutProperties, type CutRegion } from "./transforms/cut";
export { dither, DitherNode, DitherStream, type DitherProperties } from "./transforms/dither";
export { normalize, NormalizeNode, NormalizeStream, type NormalizeProperties } from "./transforms/normalize";
export { pad, PadNode, PadStream, type PadProperties } from "./transforms/pad";
export { invert, phase, PhaseNode, PhaseStream, type PhaseProperties } from "./transforms/phase";
export { reverse, ReverseNode, ReverseStream } from "./transforms/reverse";
export { splice, SpliceNode, SpliceStream, type SpliceProperties } from "./transforms/splice";
export { trim, TrimNode, TrimStream, type TrimProperties } from "./transforms/trim";

// Transforms - ffmpeg-based
export { ffmpeg, FfmpegNode, FfmpegStream, type FfmpegProperties } from "./transforms/ffmpeg";
export { resample, ResampleNode, type ResampleProperties } from "./transforms/resample";
export { loudness, LoudnessNode, LoudnessStream, type LoudnessProperties } from "./transforms/loudness";

// Transforms - engineering
export { breathControl, BreathControlNode, BreathControlStream, type BreathControlProperties } from "./transforms/breath-control";
export { deBleed, DeBleedNode, DeBleedStream, type DeBleedProperties } from "./transforms/de-bleed";
export { deClick, DeClickNode, DeClickStream, type DeClickProperties } from "./transforms/de-click";
export { deCrackle, DeCrackleNode, type DeCrackleProperties } from "./transforms/de-click/de-crackle";
export { mouthDeClick, MouthDeClickNode, type MouthDeClickProperties } from "./transforms/de-click/mouth-de-click";
export { deClip, DeClipNode, DeClipStream, type DeClipProperties } from "./transforms/de-clip";
export { dePlosive, DePlosiveNode, DePlosiveStream, type DePlosiveProperties } from "./transforms/de-plosive";
export { deReverb, DeReverbNode, DeReverbStream, type DeReverbProperties } from "./transforms/de-reverb";
export { dialogueIsolate, DialogueIsolateNode, DialogueIsolateStream, type DialogueIsolateProperties } from "./transforms/dialogue-isolate";
export { eqMatch, EqMatchNode, EqMatchStream, type EqMatchProperties } from "./transforms/eq-match";
export { leveler, LevelerNode, LevelerStream, type LevelerProperties } from "./transforms/leveler";
export { musicRebalance, MusicRebalanceNode, MusicRebalanceStream, type MusicRebalanceProperties, type StemGains } from "./transforms/music-rebalance";
export { pitchShift, PitchShiftNode, type PitchShiftProperties } from "./transforms/pitch-shift";
export { spectralRepair, SpectralRepairNode, SpectralRepairStream, type SpectralRegion, type SpectralRepairProperties } from "./transforms/spectral-repair";
export { timeStretch, TimeStretchNode, type TimeStretchProperties } from "./transforms/time-stretch";
export { voiceDenoise, VoiceDenoiseNode, VoiceDenoiseStream, type VoiceDenoiseProperties } from "./transforms/voice-denoise";

// Utilities
export { dbToLinear, linearToDb } from "./utils/db";
