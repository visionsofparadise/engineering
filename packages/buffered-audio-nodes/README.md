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

const pipeline = chain(read("input.wav"), normalize({ ceiling: 0.95 }), write("output.wav", { bitDepth: "24" }));

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

## CLI

### `process`

Run pipelines from TypeScript files. The file's default export must be a `SourceNode`.

```bash
npx @e9g/buffered-audio-nodes process --pipeline pipeline.ts
```

```ts
// pipeline.ts
import { chain, read, normalize, trim, write } from "@e9g/buffered-audio-nodes";

export default chain(read("input.wav"), normalize(), trim({ threshold: -60 }), write("output.wav"));
```

### `render`

Render a `.bag` (Buffered Audio Graph) file. BAG files are JSON-serialized graph definitions.

```bash
npx @e9g/buffered-audio-nodes render --bag pipeline.bag
```

| Flag                        | Description                         |
| --------------------------- | ----------------------------------- |
| `--chunk-size <samples>`    | Chunk size in samples               |
| `--high-water-mark <count>` | Stream backpressure high water mark |

## Nodes

### Cut

Remove a region of audio

[Source](./src/transforms/cut/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `regions` | Object[] | `[]` | Regions |
| `regions[].start` | number (min 0) | — | Start (seconds) |
| `regions[].end` | number (min 0) | — | End (seconds) |

### De-Bleed

Reduce microphone bleed between channels using spectral-domain cross-talk cancellation

[Source](./src/transforms/de-bleed/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `references` | string[] | `[]` | References |
| `reductionStrength` | number (0 to 8, step 0.1) | `3` | Reduction Strength |
| `artifactSmoothing` | number (0 to 15, step 0.1) | `4` | Artifact Smoothing |
| `fftSize` | number (512 to 16384, step 256) | `4096` | FFT Size |
| `hopSize` | number (128 to 4096, step 64) | `1024` | Hop Size |
| `vkfftAddonPath` | string | `""` | VkFFT native addon — GPU FFT acceleration Download: [vkfft-addon](https://github.com/visionsofparadise/vkfft-addon) |
| `fftwAddonPath` | string | `""` | FFTW native addon — CPU FFT acceleration Download: [fftw-addon](https://github.com/visionsofparadise/fftw-addon) |
| `dfttBackend` | "" \| "js" \| "fftw" \| "vkfft" | `""` | DFTT Backend Override |

### DeepFilterNet3 (Denoiser)

Remove background noise from speech using DeepFilterNet3 (48 kHz full-band CRN)

[Source](./src/transforms/deep-filter-net-3/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `modelPath` | string | `""` | DeepFilterNet3 48 kHz denoiser model (.onnx) Download: [dfn3](https://github.com/yuyun2000/SpeechDenoiser) |
| `ffmpegPath` | string | `""` | FFmpeg — audio/video processing tool Download: [ffmpeg](https://ffmpeg.org/download.html) |
| `onnxAddonPath` | string | `""` | ONNX Runtime native addon Download: [onnx-addon](https://github.com/visionsofparadise/onnx-runtime-addon) |
| `attenuation` | number (0 to 100) | `30` | Attenuation cap in dB. Maps to the ONNX `atten_lim_db` input; 0 = no cap |

### Dither

Add shaped noise to reduce quantization distortion

[Source](./src/transforms/dither/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `bitDepth` | 16 \| 24 | `16` | Bit Depth |
| `noiseShaping` | boolean | `false` | Noise Shaping |

### Downmix Mono

Mix all input channels to a single mono channel by averaging

[Source](./src/transforms/downmix-mono/index.ts)

### DTLN (Denoiser)

Remove background noise from speech using DTLN neural network

[Source](./src/transforms/dtln/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `modelPath1` | string | `""` | DTLN magnitude mask model (.onnx) Download: [dtln-model_1](https://github.com/breizhn/DTLN) |
| `modelPath2` | string | `""` | DTLN time-domain model (.onnx) Download: [dtln-model_2](https://github.com/breizhn/DTLN) |
| `ffmpegPath` | string | `""` | FFmpeg — audio/video processing tool Download: [ffmpeg](https://ffmpeg.org/download.html) |
| `onnxAddonPath` | string | `""` | ONNX Runtime native addon Download: [onnx-addon](https://github.com/visionsofparadise/onnx-runtime-addon) |
| `vkfftAddonPath` | string | `""` | VkFFT native addon — GPU FFT acceleration Download: [vkfft-addon](https://github.com/visionsofparadise/vkfft-addon) |
| `fftwAddonPath` | string | `""` | FFTW native addon — CPU FFT acceleration Download: [fftw-addon](https://github.com/visionsofparadise/fftw-addon) |

### Duplicate Channels

Duplicate a mono signal into multiple identical output channels

[Source](./src/transforms/duplicate-channels/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `channels` | number (2 to 8) | `2` | Output channel count |

### FFmpeg

Process audio through FFmpeg filters

[Source](./src/transforms/ffmpeg/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `ffmpegPath` | string | `""` | FFmpeg — audio/video processing tool Download: [ffmpeg](https://ffmpeg.org/download.html) |
| `args` | string[] | `[]` |  |

### Gain

Adjust signal level by a fixed amount in dB

[Source](./src/transforms/gain/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `gain` | number (-60 to 24, step 0.1) | `0` | Gain (dB) |

### HTDemucs (Stem Separator)

Rebalance stem volumes using HTDemucs source separation

[Source](./src/transforms/htdemucs/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `modelPath` | string | `""` | HTDemucs source separation model (.onnx) — requires .onnx.data file alongside Download: [htdemucs](https://github.com/facebookresearch/demucs) |
| `ffmpegPath` | string | `""` | FFmpeg — audio/video processing tool Download: [ffmpeg](https://ffmpeg.org/download.html) |
| `onnxAddonPath` | string | `""` | ONNX Runtime native addon Download: [onnx-addon](https://github.com/visionsofparadise/onnx-runtime-addon) |
| `highPass` | number (0 to 500, step 10) | `0` | High Pass |
| `lowPass` | number (0 to 22050, step 100) | `0` | Low Pass |

### Kim Vocal 2 (Stem Separator)

Isolate dialogue from background using MDX-Net vocal separation

[Source](./src/transforms/kim-vocal-2/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `modelPath` | string | `""` | MDX-Net vocal isolation model (.onnx) Download: [Kim_Vocal_2](https://huggingface.co/seanghay/uvr_models) |
| `ffmpegPath` | string | `""` | FFmpeg — audio/video processing tool Download: [ffmpeg](https://ffmpeg.org/download.html) |
| `onnxAddonPath` | string | `""` | ONNX Runtime native addon Download: [onnx-addon](https://github.com/visionsofparadise/onnx-runtime-addon) |
| `highPass` | number (20 to 500, step 10) | `80` | High Pass |
| `lowPass` | number (1000 to 22050, step 100) | `20000` | Low Pass |

### Loudness

Measure integrated, short-term, and momentary loudness

[Source](./src/transforms/loudness/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `ffmpegPath` | string | `""` | FFmpeg — audio/video processing tool Download: [ffmpeg](https://ffmpeg.org/download.html) |
| `target` | number (-50 to 0, step 0.1) | `-14` | Target |
| `truePeak` | number (-10 to 0, step 0.1) | `-1` | True Peak |
| `lra` | number (0 to 20, step 0.1) | `0` | LRA |

### Loudness Stats

Measure integrated loudness, true peak, loudness range, and short-term/momentary loudness per EBU R128

[Source](./src/targets/loudness-stats/index.ts)

### Normalize

Adjust peak or loudness level to a target ceiling

[Source](./src/transforms/normalize/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `ceiling` | number (0 to 1, step 0.01) | `1` | Ceiling |

### Pad

Add silence to start or end of audio

[Source](./src/transforms/pad/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `before` | number (min 0, step 0.001) | `0` | Before |
| `after` | number (min 0, step 0.001) | `0` | After |

### Pan

Position mono signal in stereo field or adjust stereo balance

[Source](./src/transforms/pan/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `pan` | number (-1 to 1, step 0.01) | `0` | Pan (-1 = full left, 0 = center, 1 = full right) |

### Phase

Invert or rotate signal phase

[Source](./src/transforms/phase/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `invert` | boolean | `true` | Invert |
| `angle` | number (-180 to 180, step 1), optional | — | Angle |

### Read

Read audio from a file

[Source](./src/sources/read/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `path` | string | `""` |  |
| `ffmpegPath` | string | `""` | FFmpeg — audio/video processing tool Download: [ffmpeg](https://ffmpeg.org/download.html) |
| `ffprobePath` | string | `""` | FFprobe — media file analyzer (included with FFmpeg) Download: [ffprobe](https://ffmpeg.org/download.html) |

### ReadFfmpeg

Read audio from a file using FFmpeg

[Source](./src/sources/read/ffmpeg/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `path` | string | `""` |  |
| `ffmpegPath` | string | `""` | FFmpeg — audio/video processing tool Download: [ffmpeg](https://ffmpeg.org/download.html) |
| `ffprobePath` | string | `""` | FFprobe — media file analyzer (included with FFmpeg) Download: [ffprobe](https://ffmpeg.org/download.html) |

### ReadWav

Read audio from a WAV file

[Source](./src/sources/read/wav/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `path` | string | `""` |  |

### Reverse

Reverse audio playback direction

[Source](./src/transforms/reverse/index.ts)

### Spectrogram

Generate spectrogram visualization data

[Source](./src/targets/spectrogram/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `outputPath` | string | `""` | Output Path |
| `fftSize` | number (256 to 8192, step 256) | `2048` | FFT Size |
| `hopSize` | number (64 to 8192, step 64) | `512` | Hop Size |
| `fftwAddonPath` | string | `""` | FFTW Addon |

### Splice

Replace a region of audio with processed content

[Source](./src/transforms/splice/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `insertPath` | string | `""` | Insert File Path |
| `insertAt` | number (min 0) | `0` | Insert At (frames) |

### Trim

Remove silence from start and end

[Source](./src/transforms/trim/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `threshold` | number (0 to 1, step 0.001) | `0.001` | Threshold |
| `margin` | number (0 to 1, step 0.001) | `0.01` | Margin |
| `start` | boolean | `true` | Start |
| `end` | boolean | `true` | End |

### VST3

Host a VST3 effect plugin via Pedalboard

[Source](./src/transforms/vst3/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `vstHostPath` | string | `""` | vst-host — Pedalboard-based VST3 host CLI Download: [vst-host](https://github.com/visionsofparadise/vst-host) |
| `pluginPath` | string | — | VST3 plugin file or bundle |
| `pluginName` | string, optional | — | Sub-plugin name when pluginPath is a multi-plugin shell (e.g. WaveShell) |
| `presetPath` | string, optional | — | Optional .vstpreset state file |
| `bypass` | boolean | `false` | Pass audio through unchanged |

### Waveform

Generate waveform visualization data

[Source](./src/targets/waveform/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `outputPath` | string | `""` | Output Path |
| `resolution` | number (100 to 10000, step 100) | `1000` | Resolution |

### Write

Write audio to a file

[Source](./src/targets/write/index.ts)

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `path` | string | `""` |  |
| `ffmpegPath` | string | `""` | FFmpeg — audio/video processing tool Download: [ffmpeg](https://ffmpeg.org/download.html) |
| `bitDepth` | "16" \| "24" \| "32" \| "32f" | `"16"` |  |

## Creating Nodes

Each node has two parts: a **Node** (inert descriptor) and a **Stream** (stateful runtime instance). Nodes are defined once and describe the transform. Streams are created fresh per render and hold the mutable processing state.

Extend `TransformNode` from `@e9g/buffered-audio-nodes-core` and create a companion `BufferedTransformStream`. The node's `createStream()` method produces a new stream instance for each render.

### Stream Hooks

- **`_buffer(chunk, buffer)`** — called for each incoming chunk. Override to inspect or modify data as it's buffered. Default appends to the buffer.
- **`_process(buffer)`** — called once the buffer reaches `bufferSize`. Use this for analysis or in-place modification of the full buffer.
- **`_unbuffer(chunk)`** — called for each chunk emitted from the buffer. Transform or replace the chunk here. Return `undefined` to drop it.
- **`_teardown()`** — cleanup after render completes. Close file handles, free native resources, release ONNX sessions. Called automatically on all streams.

### Buffer Size Modes

- `0` — pass-through. Each chunk flows through `_unbuffer` immediately.
- `N` — block mode. Chunks accumulate until `N` frames are collected, then `_process` runs and `_unbuffer` emits the result.
- `WHOLE_FILE` (`Infinity`) — full-file. All audio is buffered before `_process` and `_unbuffer` run.

### Example: Normalize

```ts
import { z } from "zod";
import { BufferedTransformStream, TransformNode, WHOLE_FILE, type AudioChunk, type ChunkBuffer, type TransformNodeProperties } from "@e9g/buffered-audio-nodes-core";

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

| Backend    | Provider     | Addon                                                           | Description                       |
| ---------- | ------------ | --------------------------------------------------------------- | --------------------------------- |
| VkFFT      | `gpu`        | [vkfft-addon](https://github.com/visionsofparadise/vkfft-addon) | GPU-accelerated FFT via Vulkan    |
| FFTW       | `cpu-native` | [fftw-addon](https://github.com/visionsofparadise/fftw-addon)   | Native CPU FFT                    |
| JavaScript | `cpu`        | Built-in                                                        | Pure JS fallback, no addon needed |

Pass addon paths via node properties (`vkfftAddonPath`, `fftwAddonPath`). Falls back to the built-in JavaScript implementation when no native addon is available.

## ONNX Models

ML-based transforms use ONNX Runtime for inference via a native addon. Nodes that use ONNX accept:

- `onnxAddonPath` — path to the [onnx-runtime-addon](https://github.com/visionsofparadise/onnx-runtime-addon) native binary
- `modelPath` — path to the `.onnx` model file

Models are not bundled with the package. Each node's parameter table links to the expected model source.

| Node            | Model                            | Source                                                                            |
| --------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| dtln            | model_1.onnx, model_2.onnx       | [DTLN](https://github.com/breizhn/DTLN)                                           |
| deepFilterNet3  | dfn3.onnx                        | [SpeechDenoiser](https://github.com/yuyun2000/SpeechDenoiser)                     |
| kimVocal2       | Kim_Vocal_2.onnx                 | [uvr_models](https://huggingface.co/seanghay/uvr_models)                          |
| htdemucs        | htdemucs.onnx + htdemucs.onnx.data | [demucs](https://github.com/facebookresearch/demucs)                            |

## License

ISC
