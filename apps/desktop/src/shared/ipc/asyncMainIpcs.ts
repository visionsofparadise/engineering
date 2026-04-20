import { AbortJobMainIpc } from "./Audio/abortJob/Main";
import { ApplyMainIpc } from "./Audio/apply/Main";
import { RenderGraphMainIpc } from "./Audio/renderGraph/Main";
import { ShowOpenDialogMainIpc } from "./Dialog/showOpenDialog/Main";
import { ShowSaveDialogMainIpc } from "./Dialog/showSaveDialog/Main";
import { CloseFileHandleMainIpc } from "./FileSystem/closeFileHandle/Main";
import { DeleteFileMainIpc } from "./FileSystem/deleteFile/Main";
import { EnsureDirectoryMainIpc } from "./FileSystem/ensureDirectory/Main";
import { ReadDirectoryMainIpc } from "./FileSystem/readDirectory/Main";
import { OpenFileHandleMainIpc } from "./FileSystem/openFileHandle/Main";
import { ReadFileMainIpc } from "./FileSystem/readFile/Main";
import { ReadFileChunkMainIpc } from "./FileSystem/readFileChunk/Main";
import { ReadFileHandleMainIpc } from "./FileSystem/readFileHandle/Main";
import { StatMainIpc } from "./FileSystem/stat/Main";
import { UnwatchFileMainIpc } from "./FileSystem/unwatchFile/Main";
import { WatchFileMainIpc } from "./FileSystem/watchFile/Main";
import { WriteFileMainIpc } from "./FileSystem/writeFile/Main";
import { InstallPackageMainIpc } from "./Package/install/Main";
import { LoadPackageModulesMainIpc } from "./Package/loadModules/Main";
import { UnloadPackageModulesMainIpc } from "./Package/unloadModules/Main";
import { GetAllDisplaysMainIpc } from "./System/getAllDisplays/Main";
import { GetAppVersionMainIpc } from "./System/getAppVersion/Main";
import { GetUserDataPathMainIpc } from "./System/getUserDataPath/Main";
import { GetBundledBinaryDefaultsMainIpc } from "./System/getBundledBinaryDefaults/Main";
import { ListBundledBinariesMainIpc } from "./System/listBundledBinaries/Main";
import { GetWindowIdMainIpc } from "./System/getWindowId/Main";
import { QuitAppMainIpc } from "./System/quitApp/Main";
import { SetBoundsMainIpc } from "./System/setBounds/Main";

export const ASYNC_MAIN_IPCS = [
	AbortJobMainIpc,
	ApplyMainIpc,
	RenderGraphMainIpc,
	CloseFileHandleMainIpc,
	DeleteFileMainIpc,
	EnsureDirectoryMainIpc,
	OpenFileHandleMainIpc,
	ReadDirectoryMainIpc,
	ReadFileMainIpc,
	ReadFileChunkMainIpc,
	ReadFileHandleMainIpc,
	StatMainIpc,
	UnwatchFileMainIpc,
	WatchFileMainIpc,
	WriteFileMainIpc,
	InstallPackageMainIpc,
	LoadPackageModulesMainIpc,
	UnloadPackageModulesMainIpc,
	ShowOpenDialogMainIpc,
	ShowSaveDialogMainIpc,
	GetAllDisplaysMainIpc,
	GetUserDataPathMainIpc,
	GetWindowIdMainIpc,
	GetAppVersionMainIpc,
	GetBundledBinaryDefaultsMainIpc,
	ListBundledBinariesMainIpc,
	QuitAppMainIpc,
	SetBoundsMainIpc,
];
