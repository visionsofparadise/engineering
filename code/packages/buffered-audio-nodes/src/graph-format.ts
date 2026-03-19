import { z } from "zod";
import type { RenderOptions } from "./node";
import type { BufferedAudioNode } from "./node";
import { SourceNode } from "./sources";
import { TransformNode } from "./transforms";

const graphNodeSchema = z.object({
	id: z.string().min(1),
	package: z.string().min(1),
	node: z.string().min(1),
	options: z.record(z.string(), z.unknown()).optional(),
	bypass: z.boolean().optional(),
});

const graphEdgeSchema = z.object({
	from: z.string().min(1),
	to: z.string().min(1),
});

const graphDefinitionSchema = z.object({
	name: z.string().default("Untitled"),
	nodes: z.array(graphNodeSchema),
	edges: z.array(graphEdgeSchema),
});

export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;
export type GraphDefinition = z.infer<typeof graphDefinitionSchema>;

export type NodeRegistry = Map<string, Map<string, new (options?: Record<string, unknown>) => BufferedAudioNode>>;

export function validateGraphDefinition(json: unknown): GraphDefinition {
	return graphDefinitionSchema.parse(json);
}

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

		if (fromNode instanceof SourceNode || fromNode instanceof TransformNode) {
			fromNode.to(toNode);
		} else {
			throw new Error(`Cannot connect from target node "${edge.from}"`);
		}
	}

	const targetIds = new Set(definition.edges.map((edge) => edge.to));
	const sources: Array<SourceNode> = [];

	for (const nodeDef of definition.nodes) {
		if (!targetIds.has(nodeDef.id)) {
			const node = nodeMap.get(nodeDef.id);

			if (SourceNode.is(node)) {
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
