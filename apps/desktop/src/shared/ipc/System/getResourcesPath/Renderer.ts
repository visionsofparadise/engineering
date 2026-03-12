import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export type GetResourcesPathIpcParameters = [];
export type GetResourcesPathIpcReturn = string;
export const GET_RESOURCES_PATH_ACTION = "getResourcesPath" as const;

export class GetResourcesPathRendererIpc extends AsyncRendererIpc<typeof GET_RESOURCES_PATH_ACTION, GetResourcesPathIpcParameters, GetResourcesPathIpcReturn> {
	action = GET_RESOURCES_PATH_ACTION;
}
