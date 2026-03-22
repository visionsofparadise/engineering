import type { GraphDefinition } from "buffered-audio-nodes";
import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface RenderGraphInput {
	readonly graphDefinition: GraphDefinition;
	readonly packageVersions: Record<string, string>;
	readonly userDataPath: string;
	readonly binaries: Record<string, string>;
}

export type RenderGraphIpcParameters = [input: RenderGraphInput];
export type RenderGraphIpcReturn = string;
export const RENDER_GRAPH_ACTION = "audioRenderGraph" as const;

export class RenderGraphRendererIpc extends AsyncRendererIpc<typeof RENDER_GRAPH_ACTION, RenderGraphIpcParameters, RenderGraphIpcReturn> {
	action = RENDER_GRAPH_ACTION;
}
