import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { RENDER_GRAPH_ACTION, type RenderGraphInput, type RenderGraphIpcParameters, type RenderGraphIpcReturn } from "./Renderer";

export class RenderGraphMainIpc extends AsyncMainIpc<RenderGraphIpcParameters, RenderGraphIpcReturn> {
	action = RENDER_GRAPH_ACTION;

	handler(_input: RenderGraphInput, _dependencies: IpcHandlerDependencies): RenderGraphIpcReturn {
		throw new Error("renderGraph not implemented — see plan 9");
	}
}
