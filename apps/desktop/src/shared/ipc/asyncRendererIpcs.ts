import type { IpcHandlerAction, IpcHandlerParameters, IpcHandlerReturn } from "../models/AsyncRendererIpc";
import { ShowOpenDialogRendererIpc } from "./Dialog/showOpenDialog/Renderer";
import { EnsureDirectoryRendererIpc } from "./FileSystem/ensureDirectory/Renderer";
import { ReadDirectoryRendererIpc } from "./FileSystem/readDirectory/Renderer";
import { ReadFileRendererIpc } from "./FileSystem/readFile/Renderer";
import { ReadFileBufferRendererIpc } from "./FileSystem/readFileBuffer/Renderer";
import { ReadFileChunkRendererIpc } from "./FileSystem/readFileChunk/Renderer";
import { StatRendererIpc } from "./FileSystem/stat/Renderer";
import { WriteFileRendererIpc } from "./FileSystem/writeFile/Renderer";
import { GetAllDisplaysRendererIpc } from "./System/getAllDisplays/Renderer";
import { GetAppVersionRendererIpc } from "./System/getAppVersion/Renderer";
import { GetUserDataPathRendererIpc } from "./System/getUserDataPath/Renderer";
import { GetWindowIdRendererIpc } from "./System/getWindowId/Renderer";
import { SetBoundsRendererIpc } from "./System/setBounds/Renderer";

export const ASYNC_RENDERER_IPCS = [
	EnsureDirectoryRendererIpc,
	ReadDirectoryRendererIpc,
	ReadFileRendererIpc,
	ReadFileBufferRendererIpc,
	ReadFileChunkRendererIpc,
	StatRendererIpc,
	WriteFileRendererIpc,
	ShowOpenDialogRendererIpc,
	GetAllDisplaysRendererIpc,
	GetUserDataPathRendererIpc,
	GetWindowIdRendererIpc,
	GetAppVersionRendererIpc,
	SetBoundsRendererIpc,
];

export type AsyncIpcAction = IpcHandlerAction<InstanceType<(typeof ASYNC_RENDERER_IPCS)[number]>>;
export type AsyncIpcParameters<A extends AsyncIpcAction> = IpcHandlerParameters<Extract<InstanceType<(typeof ASYNC_RENDERER_IPCS)[number]>, { action: A }>>;
export type AsyncIpcReturn<A extends AsyncIpcAction> = IpcHandlerReturn<Extract<InstanceType<(typeof ASYNC_RENDERER_IPCS)[number]>, { action: A }>>;
