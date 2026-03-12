import { AsyncMainIpc, type IpcHandlerDependencies } from "../../../models/AsyncMainIpc";
import { GET_RESOURCES_PATH_ACTION, type GetResourcesPathIpcParameters, type GetResourcesPathIpcReturn } from "./Renderer";

export class GetResourcesPathMainIpc extends AsyncMainIpc<GetResourcesPathIpcParameters, GetResourcesPathIpcReturn> {
	action = GET_RESOURCES_PATH_ACTION;

	handler(_dependencies: IpcHandlerDependencies): GetResourcesPathIpcReturn {
		return process.resourcesPath;
	}
}
