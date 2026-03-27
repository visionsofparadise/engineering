import type { BufferedAudioNode, AudioChunk, RenderOptions, StreamContext } from "./node";
import { SourceNode } from "./source";
import { TransformNode } from "./transform";

export abstract class CompositeNode extends TransformNode {
	abstract get head(): BufferedAudioNode;
	abstract get tail(): BufferedAudioNode;

	override to(child: BufferedAudioNode): void {
		if (!(this.tail instanceof SourceNode) && !(this.tail instanceof TransformNode)) {
			throw new Error("Cannot connect downstream from a TargetNode — this composite is a complete pipeline");
		}

		(this.tail as SourceNode | TransformNode).to(child);
	}

	override get children(): ReadonlyArray<BufferedAudioNode> {
		return [this.head];
	}

	override async setup(readable: ReadableStream<AudioChunk>, context: StreamContext): Promise<Array<Promise<void>>> {
		if (!(this.head instanceof TransformNode)) {
			throw new Error("Cannot setup a composite whose head is a SourceNode — use render() for complete pipelines");
		}

		return this.head.setup(readable, context);
	}

	async render(options?: RenderOptions): Promise<void> {
		if (!(this.head instanceof SourceNode)) {
			throw new Error("Cannot render a composite whose head is not a SourceNode");
		}

		return this.head.render(options);
	}
}
