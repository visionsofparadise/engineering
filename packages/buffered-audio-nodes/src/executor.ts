import type { AudioChunk, BufferedAudioNode, StreamContext } from "./node";
import { TargetNode } from "./targets";
import { TransformNode } from "./transforms";

// FIX: This seems unnecessary
function isBypassed(node: BufferedAudioNode): boolean {
	return node.properties.bypass === true;
}

// FIX: I feel like source and transform nodes should have a method that does this
function resolveChildren(node: BufferedAudioNode): Array<BufferedAudioNode> {
	const result: Array<BufferedAudioNode> = [];

	for (const child of node.getChildren()) {
		if (isBypassed(child)) {
			result.push(...resolveChildren(child));
		} else {
			result.push(child);
		}
	}

	return result;
}

// FIX: This is only used in one place, source setup
export async function setupPipeline(node: BufferedAudioNode, readable: ReadableStream<AudioChunk>, context: StreamContext): Promise<Array<Promise<void>>> {
	const resolvedChildren = resolveChildren(node);

	if (resolvedChildren.length === 0) return [];

	if (resolvedChildren.length === 1) {
		const child = resolvedChildren[0];

		if (!child) return [];

		return setupNode(child, readable, context);
	}

	const tees = teeReadable(readable, resolvedChildren.length);

	const nested = await Promise.all(
		resolvedChildren.map(async (child, index) => {
			const tee = tees[index];

			if (!tee) return [];

			return setupNode(child, tee, context);
		}),
	);

	return nested.flat();
}

async function setupNode(node: BufferedAudioNode, readable: ReadableStream<AudioChunk>, context: StreamContext): Promise<Array<Promise<void>>> {
	if (context.visited.has(node)) {
		throw new Error("Cycle detected in node graph");
	}

	context.visited.add(node);

	if (node instanceof TargetNode) {
		return [node.setup(readable, context)];
	}

	if (node instanceof TransformNode) {
		const output = await node.setup(readable, context);

		return setupPipeline(node, output, context);
	}

	return setupPipeline(node, readable, context);
}

// FIX: This seems like a util that could live on it's own
function teeReadable(readable: ReadableStream<AudioChunk>, count: number): Array<ReadableStream<AudioChunk>> {
	if (count <= 1) return [readable];

	const branches: Array<ReadableStream<AudioChunk>> = [];

	let current = readable;

	for (let offset = 0; offset < count - 1; offset++) {
		const [left, right] = current.tee();

		branches.push(left);
		current = right;
	}

	branches.push(current);

	return branches;
}
