import { AsyncRendererIpc } from "../../../models/AsyncRendererIpc";

export interface FileStat {
	size: number;
	modifiedAt: number;
}

export type StatIpcParameters = [filePath: string];
export type StatIpcReturn = FileStat | null;
export const STAT_ACTION = "stat" as const;

export class StatRendererIpc extends AsyncRendererIpc<typeof STAT_ACTION, StatIpcParameters, StatIpcReturn> {
	action = STAT_ACTION;
}
