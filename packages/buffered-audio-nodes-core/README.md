# @e9g/buffered-audio-nodes-core

Foundational protocol layer for the buffered-audio-nodes ecosystem: base classes, streaming architecture, graph format (BAG), and executor.

## Install

```sh
npm install @e9g/buffered-audio-nodes-core
```

## Overview

This package defines the abstractions that all buffered-audio-nodes packages build on. It is used by two audiences:

- **Node authors** extend `SourceNode`, `TransformNode`, or `TargetNode` to create concrete audio processing modules.
- **Graph executors** use the BAG format (`pack`, `unpack`, `renderGraph`) to serialize, deserialize, and run audio processing pipelines.

Concrete node implementations live in separate packages (e.g. `@e9g/buffered-audio-nodes`). This package provides only the protocol layer and has a single runtime dependency: `zod`.

## Node Types

Nodes are inert descriptors. They hold parameters, bypass state, and schema metadata. They are safe to serialize, reuse, and share. Each node type has a corresponding stream class that handles the actual runtime processing.

### SourceNode

Produces audio. Implements `createStream()` returning a `BufferedSourceStream` that provides a `ReadableStream<AudioChunk>`. Call `source.render(options?)` to execute the entire pipeline rooted at this source.

### TransformNode

Processes audio. Implements `createStream()` returning a `BufferedTransformStream` that pipes through a `TransformStream<AudioChunk, AudioChunk>`. Supports buffering modes via `bufferSize`.

### TargetNode

Consumes audio. Implements `createStream()` returning a `BufferedTargetStream` that writes to a `WritableStream<AudioChunk>`. Typically writes output to a file or destination.

### CompositeNode

Abstract base for multi-node compositions. Exposes `head` and `tail` properties to define the internal sub-graph. Calling `.to()` on a composite connects downstream from `tail`. If the head is a `SourceNode`, the composite can be rendered directly.

## Streams

Every render creates fresh stream instances via `node.createStream()`. Streams are mutable runtime objects that hold processing state for a single render pass. They are never reused.

```ts
class MyTransform extends TransformNode {
	readonly type = ["buffered-audio-node", "transform", "my-transform"] as const;

	createStream() {
		return new MyTransformStream(this.properties);
	}

	clone() {
		return new MyTransform(this.properties);
	}
}
```

Nodes connect with `.to()`:

```ts
source.to(transform);
transform.to(target);
await source.render();
```

Fan-out is supported by calling `.to()` multiple times from the same node.

## Transform Hooks

`BufferedTransformStream` provides four hooks for processing audio:

### `_buffer(chunk, buffer)`

Accumulate incoming audio into the `ChunkBuffer`. Default implementation calls `buffer.append(chunk.samples, ...)`. Override to pre-process or filter chunks before buffering.

### `_process(buffer)`

Called when the buffer reaches the `bufferSize` threshold (or on flush for `WHOLE_FILE` mode). Perform in-place transformations on the buffer contents. Not called when `bufferSize` is `0`.

### `_unbuffer(chunk)`

Transform individual chunks during emission. Called for every chunk read back from the buffer. Return `undefined` to drop a chunk.

### `_setup(input, context)`

Override for custom stream wiring. Default implementation pipes input through `createTransformStream()`. Use this to set up context-dependent resources before processing begins.

### bufferSize Modes

| Value | Behavior |
|---|---|
| `0` | Pass-through. Chunks flow directly through `_buffer` then `_unbuffer`. `_process` is never called. |
| `N` | Block mode. Accumulate `N` frames, call `_process`, then emit. |
| `WHOLE_FILE` | Buffer all audio before processing. `_process` runs once on flush with the complete file. |

Example transform that processes in 4096-frame blocks:

```ts
class MyTransformStream extends BufferedTransformStream {
	constructor(properties: TransformNodeProperties) {
		super({ ...properties, bufferSize: 4096 });
	}

	override async _process(buffer: ChunkBuffer): Promise<void> {
		const chunk = await buffer.read(0, buffer.frames);
		const processed = doSomething(chunk.samples);
		await buffer.write(0, processed);
	}
}
```

## Graph Format (BAG)

BAG (Buffered Audio Graph) is a JSON format for serializing audio processing pipelines. A `GraphDefinition` contains:

- `name` -- graph name
- `nodes` -- flat array of `{ id, packageName, nodeName, parameters?, options? }`
- `edges` -- flat array of `{ from, to }` referencing node IDs

### NodeRegistry

A two-level `Map<packageName, Map<nodeName, Constructor>>` that maps serialized node references back to their classes:

```ts
const registry: NodeRegistry = new Map([
	["@e9g/buffered-audio-nodes", new Map([
		["wav-source", WavSourceNode],
		["gain", GainNode],
		["wav-target", WavTargetNode],
	])],
]);
```

### pack

Serialize live nodes into a `GraphDefinition`:

```ts
import { pack } from "@e9g/buffered-audio-nodes-core";

const definition = pack([source], "my-graph");
```

### unpack

Deserialize a `GraphDefinition` back into live node instances:

```ts
import { unpack } from "@e9g/buffered-audio-nodes-core";

const sources = unpack(definition, registry);
await sources[0].render();
```

### renderGraph

Shorthand to unpack and render in one step:

```ts
import { renderGraph } from "@e9g/buffered-audio-nodes-core";

await renderGraph(definition, registry, { memoryLimit: 512 * 1024 * 1024 });
```

### validateGraphDefinition

Validates raw JSON against the BAG schema using Zod:

```ts
import { validateGraphDefinition } from "@e9g/buffered-audio-nodes-core";

const definition = validateGraphDefinition(JSON.parse(raw));
```

## ChunkBuffer

`ChunkBuffer` is the abstract base for audio sample storage used internally by `BufferedTransformStream`. Two implementations are provided:

### MemoryChunkBuffer

Stores all samples in memory using `Float32Array` per channel. Suitable for small to medium buffers.

### FileChunkBuffer

Starts in memory and automatically flushes to a temporary file when the buffer exceeds a size threshold (derived from `memoryLimit`, default ~10 MB). Interleaves channels into a single binary file for sequential I/O. Cleans up temp files on `close()` or `reset()`.

The transform stream uses `FileChunkBuffer` by default, so large files (e.g. `WHOLE_FILE` mode) do not exhaust memory.

## Backpressure

`SourceNode.render()` computes a `highWaterMark` from the pipeline depth, channel count, and chunk size, bounded by a configurable `memoryLimit` (default 256 MB). This is passed to all streams via `StreamContext` to apply consistent backpressure across the pipeline.

## License

ISC
