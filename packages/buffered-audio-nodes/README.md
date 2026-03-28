# buffered-audio-nodes

A streaming audio processing framework. Chainable nodes that read, transform, and write audio — an open, scriptable, extensible alternative to GUI-bound audio engineering tools.

## Install

```bash
npm install @e9g/buffered-audio-nodes
```

## Usage

Three node types — sources produce audio, transforms process it, targets consume it. The `chain()` function wires them into a pipeline.

```ts
import { chain, read, normalize, write } from "@e9g/buffered-audio-nodes";

const pipeline = chain(
	read("input.wav"),
	normalize({ ceiling: 0.95 }),
	write("output.wav", { bitDepth: "24" })
);

await pipeline.render();
```

`render()` streams audio through the chain. Backpressure, buffering, and lifecycle are handled by the framework.

### Fan-out

Split a stream into parallel branches by calling `.to()` multiple times from the same node:

```ts
import { chain, read, normalize, trim, write } from "@e9g/buffered-audio-nodes";

const source = read("input.wav");
const normalizeNode = normalize();
const trimNode = trim();

source.to(normalizeNode);
source.to(trimNode);
normalizeNode.to(write("normalized.wav"));
trimNode.to(write("trimmed.wav"));

await source.render();
```

### Composition with `.to()`

For graphs that are not linear chains, use `.to()` directly. `.to()` returns void, so calls are separate statements:

```ts
import { read, normalize, trim, write } from "@e9g/buffered-audio-nodes";

const source = read("input.wav");
const norm = normalize({ ceiling: 0.95 });
const trimmer = trim({ threshold: -60 });

source.to(norm);
norm.to(trimmer);
trimmer.to(write("output.wav"));

await source.render();
```

## CLI

### `process`

Run pipelines from TypeScript files. The file's default export must be a `SourceNode`.

```bash
npx @e9g/buffered-audio-nodes process --pipeline pipeline.ts
```

```ts
// pipeline.ts
import { chain, read, normalize, trim, write } from "@e9g/buffered-audio-nodes";

export default chain(
	read("input.wav"),
	normalize(),
	trim({ threshold: -60 }),
	write("output.wav")
);
```

### `render`

Render a `.bag` (Buffered Audio Graph) file. BAG files are JSON-serialized graph definitions.

```bash
npx @e9g/buffered-audio-nodes render --bag pipeline.bag
```

| Flag | Description |
|------|-------------|
| `--chunk-size <samples>` | Chunk size in samples |
| `--high-water-mark <count>` | Stream backpressure high water mark |

## Nodes

### Sources

#### `read(path, options?)`

Read audio from a file. WAV files are read natively. Other formats are transcoded via FFmpeg.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | | File path |
| `channels` | `number[]` | all | Channel indices to extract |
| `ffmpegPath` | `string` | | Path to [ffmpeg](https://ffmpeg.org/download.html). Required for non-WAV files. |
| `ffprobePath` | `string` | | Path to [ffprobe](https://ffmpeg.org/download.html). Required for non-WAV files. |

#### `readWav(path, options?)`

Read a WAV file natively.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | | File path |
| `channels` | `number[]` | all | Channel indices to extract |

#### `readFfmpeg(path, options)`

Read an audio file via FFmpeg transcoding.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | | File path |
| `channels` | `number[]` | all | Channel indices to extract |
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `ffprobePath` | `string` | | Path to ffprobe |

### Targets

#### `write(path, options?)`

Write audio to a file. Writes WAV natively. Other formats are encoded via FFmpeg.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | `string` | | Output file path |
| `bitDepth` | `"16" \| "24" \| "32" \| "32f"` | `"16"` | WAV bit depth |
| `encoding` | `EncodingOptions` | | Non-WAV encoding (format, bitrate, vbr) |
| `ffmpegPath` | `string` | | Path to [ffmpeg](https://ffmpeg.org/download.html). Required for non-WAV formats. |

#### `waveform(outputPath, options?)`

Extract waveform data to a file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `outputPath` | `string` | | Output file path |
| `resolution` | `number` | `1000` | Number of waveform points (100–10000) |

#### `spectrogram(outputPath, options?)`

Generate spectrogram data file.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `outputPath` | `string` | | Output file path |

#### `loudnessStats(options?)`

Measure loudness statistics. Access results via `.stats` after render.

### Composites

#### `chain(...nodes)`

Wire nodes into a linear pipeline. Returns a `ChainNode`.

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

#### `cut(regions, options?)`

Remove regions from audio.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `regions` | `CutRegion[]` | | Regions to remove (`{ start, end }` in samples) |

#### `pad(options)`

Add silence to start or end.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `before` | `number` | `0` | Samples of silence before audio |
| `after` | `number` | `0` | Samples of silence after audio |

#### `splice(insertPath, insertAt, options?)`

Insert audio at a position.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `insertPath` | `string` | | WAV file to insert |
| `insertAt` | `number` | `0` | Insert position in samples |

#### `reverse(options?)`

Reverse audio.

#### `phase(options?)` / `invert(options?)`

Invert polarity or shift phase.

#### `dither(options)`

Add dither noise before bit-depth reduction.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `bitDepth` | `"16" \| "24"` | `"16"` | Target bit depth |
| `noiseShaping` | `boolean` | `false` | Apply noise shaping |

#### `resample(ffmpegPath, sampleRate, options?)`

Change sample rate.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `sampleRate` | `number` | `44100` | Target sample rate (8000–192000) |
| `dither` | `"triangular" \| "lipshitz" \| "none"` | `"triangular"` | Dither method |

### Transforms — FFmpeg

These transforms require an [ffmpeg](https://ffmpeg.org/download.html) binary.

#### `ffmpeg(options)`

Run arbitrary FFmpeg filters.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `args` | `string[] \| (ctx) => string[]` | `[]` | FFmpeg filter arguments |

#### `loudness(ffmpegPath, options?)`

Adjust loudness to EBU R128 target.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `ffmpegPath` | `string` | | Path to ffmpeg |
| `target` | `number` | `-14` | Target LUFS (-50 to 0) |
| `truePeak` | `number` | `-1` | True peak limit dBTP (-10 to 0) |
| `lra` | `number` | `0` | Loudness range target (0–20) |

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

## Creating Nodes

Each node has two parts: a **Node** (inert descriptor) and a **Stream** (stateful runtime instance). Nodes are defined once and describe the transform. Streams are created fresh per render and hold the mutable processing state.

Extend `TransformNode` from `@e9g/buffered-audio-nodes-core` and create a companion `BufferedTransformStream`. The node's `createStream()` method produces a new stream instance for each render.

### Stream Hooks

- **`_buffer(chunk, buffer)`** — called for each incoming chunk. Override to inspect or modify data as it's buffered. Default appends to the buffer.
- **`_process(buffer)`** — called once the buffer reaches `bufferSize`. Use this for analysis or in-place modification of the full buffer.
- **`_unbuffer(chunk)`** — called for each chunk emitted from the buffer. Transform or replace the chunk here. Return `undefined` to drop it.

### Buffer Size Modes

- `0` — pass-through. Each chunk flows through `_unbuffer` immediately.
- `N` — block mode. Chunks accumulate until `N` frames are collected, then `_process` runs and `_unbuffer` emits the result.
- `WHOLE_FILE` (`Infinity`) — full-file. All audio is buffered before `_process` and `_unbuffer` run.

### Example: Normalize

```ts
import { z } from "zod";
import {
	BufferedTransformStream,
	TransformNode,
	WHOLE_FILE,
	type AudioChunk,
	type ChunkBuffer,
	type TransformNodeProperties,
} from "@e9g/buffered-audio-nodes-core";

const schema = z.object({
	ceiling: z.number().min(0).max(1).multipleOf(0.01).default(1.0).describe("Ceiling"),
});

interface NormalizeProperties extends z.infer<typeof schema>, TransformNodeProperties {}

class NormalizeStream extends BufferedTransformStream<NormalizeProperties> {
	private peak = 0;
	private scale = 1;

	override async _buffer(chunk: AudioChunk, buffer: ChunkBuffer): Promise<void> {
		await super._buffer(chunk, buffer);
		for (let ch = 0; ch < chunk.samples.length; ch++) {
			const channel = chunk.samples[ch] ?? new Float32Array(0);
			for (let si = 0; si < channel.length; si++) {
				const absolute = Math.abs(channel[si] ?? 0);
				if (Number.isFinite(absolute) && absolute > this.peak) this.peak = absolute;
			}
		}
	}

	override _process(_buffer: ChunkBuffer): void {
		const raw = this.peak === 0 ? 1 : this.properties.ceiling / this.peak;
		this.scale = Number.isFinite(raw) ? raw : 1;
	}

	override _unbuffer(chunk: AudioChunk): AudioChunk {
		if (this.scale === 1) return chunk;
		const scaledSamples = chunk.samples.map((channel) => {
			const scaled = new Float32Array(channel.length);
			for (let index = 0; index < channel.length; index++) {
				scaled[index] = (channel[index] ?? 0) * this.scale;
			}
			return scaled;
		});
		return { samples: scaledSamples, offset: chunk.offset, sampleRate: chunk.sampleRate, bitDepth: chunk.bitDepth };
	}
}

class NormalizeNode extends TransformNode<NormalizeProperties> {
	static override readonly moduleName = "Normalize";
	static override readonly packageName = "buffered-audio-nodes";
	static override readonly moduleDescription = "Adjust peak or loudness level to a target ceiling";
	static override readonly schema = schema;

	override readonly type = ["buffered-audio-node", "transform", "normalize"] as const;

	constructor(properties: NormalizeProperties) {
		super({ bufferSize: WHOLE_FILE, latency: WHOLE_FILE, ...properties });
	}

	override createStream(): NormalizeStream {
		return new NormalizeStream({ ...this.properties, bufferSize: this.bufferSize, overlap: this.properties.overlap ?? 0 });
	}

	override clone(overrides?: Partial<NormalizeProperties>): NormalizeNode {
		return new NormalizeNode({ ...this.properties, previousProperties: this.properties, ...overrides });
	}
}

export function normalize(options?: { ceiling?: number; id?: string }): NormalizeNode {
	return new NormalizeNode({ ceiling: options?.ceiling ?? 1.0, id: options?.id });
}
```

## FFT Backends

Transforms that use spectral processing (STFT/iSTFT) can use native FFT backends for performance. The framework selects a backend based on the stream's `executionProviders` preference:

| Backend | Provider | Addon | Description |
|---------|----------|-------|-------------|
| VkFFT | `gpu` | [vkfft-addon](https://github.com/visionsofparadise/vkfft-addon) | GPU-accelerated FFT via Vulkan |
| FFTW | `cpu-native` | [fftw-addon](https://github.com/visionsofparadise/fftw-addon) | Native CPU FFT |
| JavaScript | `cpu` | Built-in | Pure JS fallback, no addon needed |

Pass addon paths via node properties (`vkfftAddonPath`, `fftwAddonPath`). Falls back to the built-in JavaScript implementation when no native addon is available.

## ONNX Models

ML-based transforms use ONNX Runtime for inference via a native addon. Nodes that use ONNX accept:

- `onnxAddonPath` — path to the [onnx-runtime-addon](https://github.com/visionsofparadise/onnx-runtime-addon) native binary
- `modelPath` — path to the `.onnx` model file

Models are not bundled with the package. Each node's parameter table links to the expected model source.

| Node | Model | Source |
|------|-------|--------|
| DialogueIsolate | Kim_Vocal_2.onnx | [uvr_models](https://huggingface.co/seanghay/uvr_models) |
| MusicRebalance | htdemucs.onnx + .onnx.data | [demucs](https://github.com/facebookresearch/demucs) |
| VoiceDenoise | model_1.onnx, model_2.onnx | [DTLN](https://github.com/breizhn/DTLN) |

## License

ISC
