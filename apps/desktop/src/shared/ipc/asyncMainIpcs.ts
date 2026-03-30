import { ShowOpenDialogMainIpc } from "./Dialog/showOpenDialog/Main";
import { ShowSaveDialogMainIpc } from "./Dialog/showSaveDialog/Main";
import { DeleteFileMainIpc } from "./FileSystem/deleteFile/Main";
import { EnsureDirectoryMainIpc } from "./FileSystem/ensureDirectory/Main";
import { ReadDirectoryMainIpc } from "./FileSystem/readDirectory/Main";
import { ReadFileMainIpc } from "./FileSystem/readFile/Main";
import { ReadFileChunkMainIpc } from "./FileSystem/readFileChunk/Main";
import { StatMainIpc } from "./FileSystem/stat/Main";
import { WriteFileMainIpc } from "./FileSystem/writeFile/Main";
import { GitCloneMainIpc } from "./Git/clone/Main";
import { BundlePackageMainIpc } from "./Package/bundle/Main";
import { LoadPackageModulesMainIpc } from "./Package/loadModules/Main";
import { UnloadPackageModulesMainIpc } from "./Package/unloadModules/Main";
import { GetAllDisplaysMainIpc } from "./System/getAllDisplays/Main";
import { GetAppVersionMainIpc } from "./System/getAppVersion/Main";
import { GetUserDataPathMainIpc } from "./System/getUserDataPath/Main";
import { GetWindowIdMainIpc } from "./System/getWindowId/Main";
import { SetBoundsMainIpc } from "./System/setBounds/Main";

export const ASYNC_MAIN_IPCS = [
	DeleteFileMainIpc,
	EnsureDirectoryMainIpc,
	ReadDirectoryMainIpc,
	ReadFileMainIpc,
	ReadFileChunkMainIpc,
	StatMainIpc,
	WriteFileMainIpc,
	GitCloneMainIpc,
	BundlePackageMainIpc,
	LoadPackageModulesMainIpc,
	UnloadPackageModulesMainIpc,
	ShowOpenDialogMainIpc,
	ShowSaveDialogMainIpc,
	GetAllDisplaysMainIpc,
	GetUserDataPathMainIpc,
	GetWindowIdMainIpc,
	GetAppVersionMainIpc,
	SetBoundsMainIpc,
];
