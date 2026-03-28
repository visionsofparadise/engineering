import type { GraphDefinition } from "@e9g/buffered-audio-nodes-core";
import { z } from "zod";

export type NodeRenderState = "empty" | "applied" | "stale" | "processing" | "bypassed";

export const SessionStateSchema = z.object({
	positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
	monitoredNodeId: z.string().nullable(),
	viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
});

export type SessionState = z.infer<typeof SessionStateSchema>;

export interface GraphSession {
	graphDefinition: GraphDefinition;
	sessionState: SessionState;
	bagPath: string;
	nodeStates: Map<string, NodeRenderState>;
	contentHashes: Map<string, string>;
}
