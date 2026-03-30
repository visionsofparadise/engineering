import type { IpcHandlerAction, IpcHandlerParameters, IpcHandlerReturn } from "../models/AsyncRendererIpc";
import { AbortJobRendererIpc } from "./Audio/abortJob/Renderer";
import { ApplyRendererIpc } from "./Audio/apply/Renderer";
import { RenderGraphRendererIpc } from "./Audio/renderGraph/Renderer";
import { ShowOpenDialogRendererIpc } from "./Dialog/showOpenDialog/Renderer";
import { ShowSaveDialogRendererIpc } from "./Dialog/showSaveDialog/Renderer";
import { CloseFileHandleRendererIpc } from "./FileSystem/closeFileHandle/Renderer";
import { DeleteFileRendererIpc } from "./FileSystem/deleteFile/Renderer";
import { EnsureDirectoryRendererIpc } from "./FileSystem/ensureDirectory/Renderer";
import { ReadDirectoryRendererIpc } from "./FileSystem/readDirectory/Renderer";
import { OpenFileHandleRendererIpc } from "./FileSystem/openFileHandle/Renderer";
import { ReadFileRendererIpc } from "./FileSystem/readFile/Renderer";
import { ReadFileChunkRendererIpc } from "./FileSystem/readFileChunk/Renderer";
import { ReadFileHandleRendererIpc } from "./FileSystem/readFileHandle/Renderer";
import { StatRendererIpc } from "./FileSystem/stat/Renderer";
import { UnwatchFileRendererIpc } from "./FileSystem/unwatchFile/Renderer";
import { WatchFileRendererIpc } from "./FileSystem/watchFile/Renderer";
import { WriteFileRendererIpc } from "./FileSystem/writeFile/Renderer";
import { GitCloneRendererIpc } from "./Git/clone/Renderer";
import { BundlePackageRendererIpc } from "./Package/bundle/Renderer";
import { LoadPackageModulesRendererIpc } from "./Package/loadModules/Renderer";
import { UnloadPackageModulesRendererIpc } from "./Package/unloadModules/Renderer";
import { GetAllDisplaysRendererIpc } from "./System/getAllDisplays/Renderer";
import { GetAppVersionRendererIpc } from "./System/getAppVersion/Renderer";
import { GetUserDataPathRendererIpc } from "./System/getUserDataPath/Renderer";
import { GetWindowIdRendererIpc } from "./System/getWindowId/Renderer";
import { SetBoundsRendererIpc } from "./System/setBounds/Renderer";

export const ASYNC_RENDERER_IPCS = [
	AbortJobRendererIpc,
	ApplyRendererIpc,
	RenderGraphRendererIpc,
	CloseFileHandleRendererIpc,
	DeleteFileRendererIpc,
	EnsureDirectoryRendererIpc,
	OpenFileHandleRendererIpc,
	ReadDirectoryRendererIpc,
	ReadFileRendererIpc,
	ReadFileChunkRendererIpc,
	ReadFileHandleRendererIpc,
	StatRendererIpc,
	UnwatchFileRendererIpc,
	WatchFileRendererIpc,
	WriteFileRendererIpc,
	GitCloneRendererIpc,
	BundlePackageRendererIpc,
	LoadPackageModulesRendererIpc,
	UnloadPackageModulesRendererIpc,
	ShowOpenDialogRendererIpc,
	ShowSaveDialogRendererIpc,
	GetAllDisplaysRendererIpc,
	GetUserDataPathRendererIpc,
	GetWindowIdRendererIpc,
	GetAppVersionRendererIpc,
	SetBoundsRendererIpc,
];

export type AsyncIpcAction = IpcHandlerAction<InstanceType<(typeof ASYNC_RENDERER_IPCS)[number]>>;
export type AsyncIpcParameters<A extends AsyncIpcAction> = IpcHandlerParameters<Extract<InstanceType<(typeof ASYNC_RENDERER_IPCS)[number]>, { action: A }>>;
export type AsyncIpcReturn<A extends AsyncIpcAction> = IpcHandlerReturn<Extract<InstanceType<(typeof ASYNC_RENDERER_IPCS)[number]>, { action: A }>>;
