import type { AudioChunk, RenderOptions } from "./node";
import { BufferedAudioNode } from "./node";
import type { SourceNode } from "./source";
import type { TransformNode } from "./transform";
import type { TargetNode } from "./target";
import type { GraphDefinition } from "./graph-format";

export type NodeRegistry = Map<string, Map<string, new (options?: Record<string, unknown>) => BufferedAudioNode>>;

function isSourceNode(value: unknown): value is SourceNode {
	return BufferedAudioNode.is(value) && value.type[1] === "source";
}

function isTransformNode(value: unknown): value is TransformNode {
	return BufferedAudioNode.is(value) && value.type[1] === "transform";
}

function isTargetNode(value: unknown): value is TargetNode {
	return BufferedAudioNode.is(value) && value.type[1] === "target";
}

function detectCycle(node: BufferedAudioNode): void {
	const visited = new Set<BufferedAudioNode>();
	const stack = new Set<BufferedAudioNode>();

	function walk(current: BufferedAudioNode): void {
		if (stack.has(current)) {
			throw new Error("Cycle detected in node graph");
		}
		if (visited.has(current)) return;

		visited.add(current);
		stack.add(current);

		for (const child of current.children) {
			walk(child);
		}

		stack.delete(current);
	}

	walk(node);
}

export function executeGraph(
	source: SourceNode,
	readable: ReadableStream<AudioChunk>,
): Promise<void> {
	detectCycle(source);
	return walkNode(source, readable);
}

function isBypassed(child: BufferedAudioNode): boolean {
	return "bypass" in child.properties && (child.properties as { bypass?: boolean }).bypass === true;
}

function walkNode(
	node: BufferedAudioNode,
	readable: ReadableStream<AudioChunk>,
): Promise<void> {
	const activeChildren = node.children.filter(child => !isBypassed(child));
	const bypassedChildren = node.children.filter(child => isBypassed(child));

	const allTargets = [
		...activeChildren,
		...bypassedChildren.flatMap(child => child.children),
	];

	if (allTargets.length === 0) {
		return readable.pipeTo(new WritableStream<AudioChunk>());
	}

	const first = allTargets[0];
	if (allTargets.length === 1 && first !== undefined) {
		return pipeToNode(first, readable);
	}

	const branches = teeReadable(readable, allTargets.length);
	const promises: Array<Promise<void>> = [];

	for (let offset = 0; offset < allTargets.length; offset++) {
		const target = allTargets[offset];
		const branch = branches[offset];
		if (target !== undefined && branch !== undefined) {
			promises.push(pipeToNode(target, branch));
		}
	}

	return Promise.all(promises).then(() => undefined);
}

function pipeToNode(
	node: BufferedAudioNode,
	readable: ReadableStream<AudioChunk>,
): Promise<void> {
	if (isTargetNode(node)) {
		const writable = node.createWritable();
		return readable.pipeTo(writable);
	}

	if (isTransformNode(node)) {
		const transform = node.createTransform();
		const output = readable.pipeThrough(transform);
		return walkNode(node, output);
	}

	return walkNode(node, readable);
}

function teeReadable(
	readable: ReadableStream<AudioChunk>,
	count: number,
): Array<ReadableStream<AudioChunk>> {
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

export function graphDefinitionToNodes(
	definition: GraphDefinition,
	registry: NodeRegistry,
): Array<SourceNode> {
	const nodeMap = new Map<string, BufferedAudioNode>();

	for (const nodeDef of definition.nodes) {
		const packageModules = registry.get(nodeDef.package);
		if (!packageModules) throw new Error(`Unknown package: "${nodeDef.package}"`);

		const NodeClass = packageModules.get(nodeDef.node);
		if (!NodeClass) throw new Error(`Unknown node: "${nodeDef.node}" in package "${nodeDef.package}"`);

		const instance = new NodeClass(nodeDef.options);
		nodeMap.set(nodeDef.id, instance);
	}

	for (const edge of definition.edges) {
		const fromNode = nodeMap.get(edge.from);
		const toNode = nodeMap.get(edge.to);

		if (!fromNode) throw new Error(`Edge references unknown node: "${edge.from}"`);
		if (!toNode) throw new Error(`Edge references unknown node: "${edge.to}"`);

		fromNode.to(toNode);
	}

	const targetIds = new Set(definition.edges.map(edge => edge.to));
	const sources: Array<SourceNode> = [];

	for (const nodeDef of definition.nodes) {
		if (!targetIds.has(nodeDef.id)) {
			const node = nodeMap.get(nodeDef.id);
			if (node !== undefined && isSourceNode(node)) {
				sources.push(node);
			}
		}
	}

	if (sources.length === 0) {
		throw new Error("No source nodes found in graph definition");
	}

	return sources;
}

export async function renderGraph(
	definition: GraphDefinition,
	registry: NodeRegistry,
	options?: RenderOptions,
): Promise<void> {
	const sources = graphDefinitionToNodes(definition, registry);
	await Promise.all(sources.map(source => source.render(options)));
}
