import { z } from "zod";

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

export function validateGraphDefinition(json: unknown): GraphDefinition {
	return graphDefinitionSchema.parse(json);
}
