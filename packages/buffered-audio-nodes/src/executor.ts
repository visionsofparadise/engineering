import type { GraphDefinition } from "./graph-format";
import type { AudioChunk, RenderOptions, StreamContext } from "./node";
import { BufferedAudioNode } from "./node";
import type { SourceNode } from "./sources";
import type { TargetNode } from "./targets";
import type { TransformNode } from "./transforms";

export type NodeRegistry = Map<string, Map<string, new (options?: Record<string, unknown>) => BufferedAudioNode>>;

// FIX: These guards are redundant, the classes have their own guards or instanceof
function isSourceNode(value: unknown): value is SourceNode {
	return BufferedAudioNode.is(value) && value.type[1] === "source";
}

function isTransformNode(value: unknown): value is TransformNode {
	return BufferedAudioNode.is(value) && value.type[1] === "transform";
}

function isTargetNode(value: unknown): value is TargetNode {
	return BufferedAudioNode.is(value) && value.type[1] === "target";
}

// FIX: This needs to happen through our recursions, not externally
export function detectCycle(node: BufferedAudioNode): void {
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

// FIX: Along with fix for properties interface, no need to cast here
function isBypassed(node: BufferedAudioNode): boolean {
	return "bypass" in node.properties && (node.properties as { bypass?: boolean }).bypass === true;
}

// FIX: Our Target node class incorrectly has to() and children, instead we should only implement them on Source and Transform. This utility should then do a type check first
function resolveChildren(node: BufferedAudioNode): Array<BufferedAudioNode> {
	const result: Array<BufferedAudioNode> = [];

	for (const child of node.children) {
		if (isBypassed(child)) {
			result.push(...resolveChildren(child));
		} else {
			result.push(child);
		}
	}

	return result;
}

export function setupPipeline(node: BufferedAudioNode, readable: ReadableStream<AudioChunk>, context: StreamContext): Array<Promise<void>> {
	const effectiveChildren = resolveChildren(node);

	if (effectiveChildren.length === 0) return [];

	if (effectiveChildren.length === 1) {
		const only = effectiveChildren[0];
		if (!only) return [];
		return setupNode(only, readable, context);
	}

	const tees = teeReadable(readable, effectiveChildren.length);
	return effectiveChildren.flatMap((child, index) => {
		const tee = tees[index];
		if (!tee) return [];
		return setupNode(child, tee, context);
	});
}

function setupNode(node: BufferedAudioNode, readable: ReadableStream<AudioChunk>, context: StreamContext): Array<Promise<void>> {
	if (isTargetNode(node)) {
		const stream = node.createStream(context);
		const writable = stream.createWritableStream();
		node.streams.push(stream);
		return [readable.pipeTo(writable)];
	}

	if (isTransformNode(node)) {
		const stream = node.createStream(context);
		const output = stream.setup(readable);
		node.streams.push(stream);
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

// FIX: Can we move the following utilities to the graph-format file?
export function graphDefinitionToNodes(definition: GraphDefinition, registry: NodeRegistry): Array<SourceNode> {
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

	const targetIds = new Set(definition.edges.map((edge) => edge.to));
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

export async function renderGraph(definition: GraphDefinition, registry: NodeRegistry, options?: RenderOptions): Promise<void> {
	const sources = graphDefinitionToNodes(definition, registry);
	await Promise.all(sources.map((source) => source.render(options)));
}
