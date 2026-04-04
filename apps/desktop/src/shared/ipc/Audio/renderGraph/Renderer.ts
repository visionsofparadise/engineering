import type { GraphDefinition } from "@e9g/buffered-audio-nodes-core";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface RenderGraphInput {
	bagId: string;
	graphDefinition: GraphDefinition;
	packageVersions: Record<string, string>;
	snapshotsDir: string;
}

export type RenderGraphIpcParameters = [input: RenderGraphInput];
export interface RenderGraphIpcReturn { jobId: string }
export const RENDER_GRAPH_ACTION = "audioRenderGraph" as const;

export class RenderGraphRendererIpc extends AsyncRendererIpc<typeof RENDER_GRAPH_ACTION, RenderGraphIpcParameters, RenderGraphIpcReturn> {
	action = RENDER_GRAPH_ACTION;
}
