# buffered-audio-nodes

A streaming audio processing protocol. Chainable modules that read, transform, and write audio — an open, scriptable, extensible alternative to GUI-bound audio engineering tools.

## Install

```bash
npm install buffered-audio-nodes
```

## Usage

Three module types — sources produce audio, transforms process it, targets consume it. The `chain()` function wires them into a pipeline.

```ts
import { chain, read, normalize, write } from "buffered-audio-nodes";

const source = chain(
  read("input.wav"),
  normalize({ ceiling: 0.95 }),
  write("output.wav", { bitDepth: "24" })
);

await source.render();
```

`render()` streams audio through the chain. Backpressure, buffering, and lifecycle are handled by the framework.

### Fan

Split a stream into parallel branches with `fan()`:

```ts
import { chain, read, fan, normalize, trim, write } from "buffered-audio-nodes";

const source = chain(
  read("input.wav"),
  fan(
    chain(normalize(), write("normalized.wav")),
    chain(trim(), write("trimmed.wav"))
  )
);

await source.render();
```

## CLI

Run pipelines from TypeScript files. The file's default export must be a `SourceModule`.

```bash
npx buffered-audio-nodes process --pipeline pipeline.ts
```

```ts
// pipeline.ts
import { chain, read, normalize, trim, write } from "buffered-audio-nodes";

export default chain(
  read("input.wav"),
  normalize(),
  trim({ threshold: -60 }),
  write("output.wav")
);
```

| Flag | Description |
|------|-------------|
| `--chunk-size <samples>` | Chunk size in samples |
| `--high-water-mark <count>` | Stream backpressure high water mark |

## Modules

### Sources

#### `read(path, options?)`

Read audio from a file. WAV files are read natively. Other formats are transcoded via FFmpeg.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | | File path |
| `channels` | `number[]` | all | Channel indices to extract |
| `ffmpegPath` | `string` | | Path to [ffmpeg](https://ffmpeg.org/download.html). Required for non-WAV files. |
| `ffprobePath` | `string` | | Path to [ffprobe](https://ffmpeg.org/download.html). Required for non-WAV files. |

### Targets

#### `write(path, options?)`

Write audio to a file. Writes WAV natively. Other formats are encoded via FFmpeg.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | | Output file path |
| `bitDepth` | `"16" \| "24" \| "32" \| "32f"` | `"16"` | WAV bit depth |
| `encoding` | `EncodingOptions` | | Non-WAV encoding (format, bitrate, vbr) |
| `ffmpegPath` | `string` | | Path to [ffmpeg](https://ffmpeg.org/download.html). Required for non-WAV formats. |

### Composites

#### `chain(...modules)`

Wire modules into a linear pipeline. Returns the source module.

#### `fan(...branches)`

Split a stream into parallel transform branches.

### Transforms — Basic

#### `normalize(options?)`

Adjust peak level to a target ceiling.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ceiling` | `number` | `1.0` | Target peak level (0–1) |

#### `trim(options?)`

Remove silence from start and end.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | `number` | `0.001` | Silence threshold (0–1) |
| `margin` | `number` | `0.01` | Margin to keep around content (0–1) |
| `start` | `boolean` | `true` | Trim start |
| `end` | `boolean` | `true` | Trim end |

#### `cut(options?)`

Remove regions from audio.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `regions` | `CutRegion[]` | | Regions to remove (`{ start, end }` in samples) |

#### `pad(options?)`

Add silence to start or end.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `before` | `number` | `0` | Samples of silence before audio |
| `after` | `number` | `0` | Samples of silence after audio |

#### `dither(options?)`

Add dither noise before bit-depth reduction.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `bitDepth` | `"16" \| "24"` | `"16"` | Target bit depth |
| `noiseShaping` | `boolean` | `false` | Apply noise shaping |

#### `phase(options?)` / `invert()`

Invert polarity or shift phase.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `invert` | `boolean` | `true` | Invert polarity |
| `angle` | `number` | `0` | Phase angle (-180 to 180) |

#### `reverse()`

Reverse audio. No parameters.

#### `splice(options?)`

Insert audio at a position.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `insertPath` | `string` | | WAV file to insert |
| `insertAt` | `number` | `0` | Insert position in samples |

#### `waveform(options?)`

Extract waveform data to a file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `outputPath` | `string` | | Output file path |
| `resolution` | `number` | `1000` | Number of waveform points (100–10000) |

### Transforms — FFmpeg

These transforms require an [ffmpeg](https://ffmpeg.org/download.html) binary.

#### `ffmpeg(options)`

Run arbitrary FFmpeg filters.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `args` | `string[] \| (ctx) => string[]` | `[]` | FFmpeg filter arguments |

#### `resample(ffmpegPath, sampleRate, options?)`

Change sample rate.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `sampleRate` | `number` | `44100` | Target sample rate (8000–192000) |
| `dither` | `"triangular" \| "lipshitz" \| "none"` | `"triangular"` | Dither method |

#### `loudness(ffmpegPath, options?)`

Adjust loudness to EBU R128 target.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `target` | `number` | `-14` | Target LUFS (-50 to 0) |
| `truePeak` | `number` | `-1` | True peak limit dBTP (-10 to 0) |
| `lra` | `number` | `0` | Loudness range target (0–20) |

#### `loudnessStats(options?)`

Measure loudness statistics. Access results via `.stats` after render. No parameters.

#### `spectrogram(outputPath, options?)`

Generate spectrogram data file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `outputPath` | `string` | | Output file path |
| `fftSize` | `number` | `2048` | FFT size (256–8192) |
| `hopSize` | `number` | `512` | Hop size (64–4096) |
| `frequencyScale` | `"linear" \| "log"` | `"log"` | Frequency axis scale |
| `numBands` | `number` | `512` | Number of frequency bands (log scale) |
| `minFrequency` | `number` | `20` | Minimum frequency in Hz |
| `maxFrequency` | `number` | `sr/2` | Maximum frequency in Hz |

### Transforms — Audio Engineering

#### `breathControl(options?)`

Reduce or remove breath sounds.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sensitivity` | `number` | `0.5` | Detection sensitivity (0–1) |
| `reduction` | `number` | `-12` | Reduction in dB (-60 to 0) |
| `mode` | `"remove" \| "attenuate"` | `"attenuate"` | Processing mode |

#### `deBleed(referencePath, options?)`

Remove microphone bleed using a reference signal.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `referencePath` | `string` | | Path to reference WAV |
| `filterLength` | `number` | `1024` | Adaptive filter length (64–8192) |
| `stepSize` | `number` | `0.1` | Adaptation step size (0.001–1) |

#### `deClick(options?)`

Remove clicks and pops.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sensitivity` | `number` | `0.5` | Detection sensitivity (0–1) |
| `maxClickDuration` | `number` | `200` | Max click duration in samples (1–1000) |

#### `deCrackle(options?)`

Remove crackle noise.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sensitivity` | `number` | `0.5` | Detection sensitivity (0–1) |

#### `mouthDeClick(options?)`

Remove mouth clicks.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sensitivity` | `number` | `0.7` | Detection sensitivity (0–1) |

#### `deClip(options?)`

Repair clipped audio.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `threshold` | `number` | `0.99` | Clipping detection threshold (0–1) |
| `method` | `"ar" \| "sparse"` | `"ar"` | Repair method |

#### `dePlosive(options?)`

Reduce plosive sounds.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sensitivity` | `number` | `0.5` | Detection sensitivity (0–1) |
| `frequency` | `number` | `200` | Plosive frequency cutoff in Hz (50–500) |

#### `deReverb(options?)`

Reduce reverb and room tone using WPE dereverberation.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `sensitivity` | `number` | `0.5` | Controls prediction delay, filter length, and iterations (0–1) |
| `predictionDelay` | `number` | | Prediction delay in frames (1–10) |
| `filterLength` | `number` | | Filter length in frames (5–30) |
| `iterations` | `number` | | WPE iterations (1–10) |
| `vkfftAddonPath` | `string` | | Path to [vkfft-addon](https://github.com/visionsofparadise/vkfft-addon) (GPU FFT) |
| `fftwAddonPath` | `string` | | Path to [fftw-addon](https://github.com/visionsofparadise/fftw-addon) (CPU FFT) |

#### `dialogueIsolate(options)`

Isolate dialogue using MDX-Net vocal separation.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `modelPath` | `string` | | Path to [Kim_Vocal_2.onnx](https://huggingface.co/seanghay/uvr_models) |
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `onnxAddonPath` | `string` | | Path to [onnx-runtime-addon](https://github.com/visionsofparadise/onnx-runtime-addon) |
| `highPass` | `number` | `80` | High pass filter in Hz (20–500) |
| `lowPass` | `number` | `20000` | Low pass filter in Hz (1000–22050) |

#### `eqMatch(referencePath, options?)`

Match EQ profile to a reference recording.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `referencePath` | `string` | | Path to reference WAV |
| `smoothing` | `number` | `0.33` | Spectral smoothing (0–1) |
| `vkfftAddonPath` | `string` | | Path to [vkfft-addon](https://github.com/visionsofparadise/vkfft-addon) |
| `fftwAddonPath` | `string` | | Path to [fftw-addon](https://github.com/visionsofparadise/fftw-addon) |

#### `leveler(options?)`

Automatic level control.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `target` | `number` | `-20` | Target level in dB (-60 to 0) |
| `window` | `number` | `0.5` | Analysis window in seconds (0.01–5) |
| `speed` | `number` | `0.1` | Adjustment speed (0.01–1) |
| `maxGain` | `number` | `12` | Maximum gain in dB (0–40) |
| `maxCut` | `number` | `12` | Maximum cut in dB (0–40) |

#### `musicRebalance(modelPath, stems, options?)`

Adjust stem levels using HTDemucs source separation.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `modelPath` | `string` | | Path to [htdemucs.onnx](https://github.com/facebookresearch/demucs) (requires .onnx.data file alongside) |
| `stems` | `Partial<StemGains>` | | Gain per stem: `{ vocals, drums, bass, other }` |
| `onnxAddonPath` | `string` | | Path to [onnx-runtime-addon](https://github.com/visionsofparadise/onnx-runtime-addon) |

#### `pitchShift(ffmpegPath, semitones, options?)`

Shift pitch without changing duration.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `semitones` | `number` | | Semitones to shift (-24 to 24) |
| `cents` | `number` | `0` | Cents to shift (-100 to 100) |

#### `spectralRepair(regions, options?)`

Repair spectral regions.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `regions` | `SpectralRegion[]` | | Regions to repair (`{ startTime, endTime, startFreq, endFreq }`) |
| `method` | `"ar" \| "nmf"` | `"ar"` | Repair method |
| `vkfftAddonPath` | `string` | | Path to [vkfft-addon](https://github.com/visionsofparadise/vkfft-addon) |
| `fftwAddonPath` | `string` | | Path to [fftw-addon](https://github.com/visionsofparadise/fftw-addon) |

#### `timeStretch(ffmpegPath, rate, options?)`

Change duration without affecting pitch.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `rate` | `number` | | Time stretch rate (0.25–4) |

#### `voiceDenoise(options)`

Remove background noise from speech using DTLN.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `modelPath1` | `string` | | Path to [DTLN model_1.onnx](https://github.com/breizhn/DTLN) (magnitude mask estimation) |
| `modelPath2` | `string` | | Path to [DTLN model_2.onnx](https://github.com/breizhn/DTLN) (signal reconstruction) |
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `onnxAddonPath` | `string` | | Path to [onnx-runtime-addon](https://github.com/visionsofparadise/onnx-runtime-addon) |
| `vkfftAddonPath` | `string` | | Path to [vkfft-addon](https://github.com/visionsofparadise/vkfft-addon) |
| `fftwAddonPath` | `string` | | Path to [fftw-addon](https://github.com/visionsofparadise/fftw-addon) |

## Creating Modules

Extend `SourceModule`, `TransformModule`, or `TargetModule`.

### Transform

The most common module type. A transform's `bufferSize` controls how audio is collected before processing:

- `0` — streaming. Each chunk passes through `_unbuffer` immediately.
- `n` — block-based. Chunks accumulate in a `ChunkBuffer` until `n` frames are collected, then `_process` runs on the buffer and `_unbuffer` emits the result.
- `Infinity` — full-file. All audio is buffered before `_process` and `_unbuffer` run.

The three hooks:

- **`_buffer(chunk, buffer)`** — called for each incoming chunk. Override to inspect or modify data as it's buffered. Default appends to the buffer.
- **`_process(buffer)`** — called once the buffer reaches `bufferSize`. Use this for analysis or in-place modification of the full buffer.
- **`_unbuffer(chunk)`** — called for each chunk emitted from the buffer. Transform or replace the chunk here. Return `undefined` to drop it.

```ts
import {
  TransformModule,
  type TransformModuleProperties,
  type AudioChunk,
  type ChunkBuffer,
} from "buffered-audio-nodes";
import { z } from "zod";

const schema = z.object({
  ceiling: z.number().min(0).max(1).default(1.0),
});

interface NormalizeProperties extends z.infer<typeof schema>, TransformModuleProperties {}

class NormalizeModule extends TransformModule<NormalizeProperties> {
  static override readonly moduleName = "Normalize";
  static override readonly moduleDescription = "Adjust peak level to a target ceiling";
  static override readonly schema = schema;

  override readonly type = ["buffered-audio-node", "transform", "normalize"] as const;

  // Buffer all audio before processing — we need to find the peak first
  override readonly bufferSize = Infinity;
  override readonly latency = Infinity;

  private peak = 0;
  private scale = 1;

  // _buffer: called for each incoming chunk. Track the peak while buffering.
  override async _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> {
    await super._buffer(chunk, buffer);

    for (const channel of chunk.samples) {
      for (const sample of channel) {
        const absolute = Math.abs(sample);
        if (absolute > this.peak) this.peak = absolute;
      }
    }
  }

  // _process: called once all audio is buffered. Compute the gain scale.
  override _process(_buffer: ChunkBuffer): void {
    this.scale = this.peak === 0 ? 1 : this.properties.ceiling / this.peak;
  }

  // _unbuffer: called for each chunk emitted from the buffer. Apply the gain.
  override _unbuffer(chunk: AudioChunk): AudioChunk {
    if (this.scale === 1) return chunk;

    const scaled = chunk.samples.map((channel) => {
      const out = new Float32Array(channel.length);
      for (let i = 0; i < channel.length; i++) {
        out[i] = (channel[i] ?? 0) * this.scale;
      }
      return out;
    });

    return { samples: scaled, offset: chunk.offset, duration: chunk.duration };
  }

  clone(overrides?: Partial<NormalizeProperties>): NormalizeModule {
    return new NormalizeModule({ ...this.properties, previousProperties: this.properties, ...overrides });
  }
}

export function normalize(options?: { ceiling?: number }): NormalizeModule {
  return new NormalizeModule({ ceiling: options?.ceiling ?? 1.0 });
}
```

### Source

Implement `_init` to return stream metadata (`sampleRate`, `channels`, `duration`), `_read` to produce chunks via the controller, and `_flush` for cleanup.

### Target

Implement `_write` to consume each chunk and `_close` to finalize (close file handles, flush buffers).

### FFT Backends

Transforms that use spectral processing (STFT/iSTFT) can use native FFT backends for performance. The framework selects a backend based on the stream's `executionProviders` preference:

| Backend | Provider | Addon | Description |
|---------|----------|-------|-------------|
| VkFFT | `gpu` | [vkfft-addon](https://github.com/visionsofparadise/vkfft-addon) | GPU-accelerated FFT via Vulkan |
| FFTW | `cpu-native` | [fftw-addon](https://github.com/visionsofparadise/fftw-addon) | Native CPU FFT |
| JavaScript | `cpu` | Built-in | Pure JS fallback, no addon needed |

Pass addon paths via module properties (`vkfftAddonPath`, `fftwAddonPath`). Falls back to the built-in JavaScript implementation when no native addon is available.

### ONNX Models

ML-based transforms use ONNX Runtime for inference via a native addon. Modules that use ONNX accept:

- `onnxAddonPath` — path to the [onnx-runtime-addon](https://github.com/visionsofparadise/onnx-runtime-addon) native binary
- `modelPath` — path to the `.onnx` model file

Models are not bundled with the package. Each module's parameter table links to the expected model source.

| Module | Model | Source |
|--------|-------|--------|
| DialogueIsolate | Kim_Vocal_2.onnx | [uvr_models](https://huggingface.co/seanghay/uvr_models) |
| MusicRebalance | htdemucs.onnx + .onnx.data | [demucs](https://github.com/facebookresearch/demucs) |
| VoiceDenoise | model_1.onnx, model_2.onnx | [DTLN](https://github.com/breizhn/DTLN) |

## License

ISC
