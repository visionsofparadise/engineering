import type { AudioChunk, BufferedAudioNode, StreamContext } from "./node";
import { TargetNode } from "./targets";
import { TransformNode } from "./transforms";

function isBypassed(node: BufferedAudioNode): boolean {
	return node.properties.bypass === true;
}

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

export function setupPipeline(node: BufferedAudioNode, readable: ReadableStream<AudioChunk>, context: StreamContext): Array<Promise<void>> {
	const resolvedChildren = resolveChildren(node);

	if (resolvedChildren.length === 0) return [];

	if (resolvedChildren.length === 1) {
		const only = resolvedChildren[0];

		if (!only) return [];

		return setupNode(only, readable, context);
	}

	const tees = teeReadable(readable, resolvedChildren.length);

	return resolvedChildren.flatMap((child, index) => {
		const tee = tees[index];

		if (!tee) return [];

		return setupNode(child, tee, context);
	});
}

function setupNode(node: BufferedAudioNode, readable: ReadableStream<AudioChunk>, context: StreamContext): Array<Promise<void>> {
	if (context.visited.has(node)) {
		throw new Error("Cycle detected in node graph");
	}

	context.visited.add(node);

	if (node instanceof TargetNode) {
		return [node.setup(readable, context)];
	}

	if (node instanceof TransformNode) {
		const output = node.setup(readable, context);

		return setupPipeline(node, output, context);
	}

	return setupPipeline(node, readable, context);
}

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
