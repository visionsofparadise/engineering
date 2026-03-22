import { AbortJobMainIpc } from "./Audio/abortJob/Main";
import { ApplyMainIpc } from "./Audio/apply/Main";
import { RenderGraphMainIpc } from "./Audio/renderGraph/Main";
import { ShowOpenDialogMainIpc } from "./Dialog/showOpenDialog/Main";
import { ShowSaveDialogMainIpc } from "./Dialog/showSaveDialog/Main";
import { DeleteFileMainIpc } from "./FileSystem/deleteFile/Main";
import { EnsureDirectoryMainIpc } from "./FileSystem/ensureDirectory/Main";
import { ReadDirectoryMainIpc } from "./FileSystem/readDirectory/Main";
import { ReadFileMainIpc } from "./FileSystem/readFile/Main";
import { ReadFileBufferMainIpc } from "./FileSystem/readFileBuffer/Main";
import { ReadFileChunkMainIpc } from "./FileSystem/readFileChunk/Main";
import { ReadSpectrogramRangeMainIpc } from "./FileSystem/readSpectrogramRange/Main";
import { ReadWaveformRangeMainIpc } from "./FileSystem/readWaveformRange/Main";
import { StatMainIpc } from "./FileSystem/stat/Main";
import { WriteFileMainIpc } from "./FileSystem/writeFile/Main";
import { GitCloneMainIpc } from "./Git/clone/Main";
import { BundlePackageMainIpc } from "./Package/bundle/Main";
import { LoadPackageModulesMainIpc } from "./Package/loadModules/Main";
import { UnloadPackageModulesMainIpc } from "./Package/unloadModules/Main";
import { OpenSessionMainIpc } from "./Session/openSession/Main";
import { SaveSessionMainIpc } from "./Session/saveSession/Main";
import { GetAllDisplaysMainIpc } from "./System/getAllDisplays/Main";
import { GetAppVersionMainIpc } from "./System/getAppVersion/Main";
import { GetResourcesPathMainIpc } from "./System/getResourcesPath/Main";
import { GetUserDataPathMainIpc } from "./System/getUserDataPath/Main";
import { GetWindowIdMainIpc } from "./System/getWindowId/Main";
import { SetBoundsMainIpc } from "./System/setBounds/Main";

export const ASYNC_MAIN_IPCS = [
	AbortJobMainIpc,
	ApplyMainIpc,
	RenderGraphMainIpc,
	BundlePackageMainIpc,
	DeleteFileMainIpc,
	EnsureDirectoryMainIpc,
	GitCloneMainIpc,
	LoadPackageModulesMainIpc,
	ReadDirectoryMainIpc,
	ReadFileMainIpc,
	ReadFileBufferMainIpc,
	ReadFileChunkMainIpc,
	ReadSpectrogramRangeMainIpc,
	ReadWaveformRangeMainIpc,
	StatMainIpc,
	UnloadPackageModulesMainIpc,
	WriteFileMainIpc,
	OpenSessionMainIpc,
	SaveSessionMainIpc,
	ShowOpenDialogMainIpc,
	ShowSaveDialogMainIpc,
	GetAllDisplaysMainIpc,
	GetResourcesPathMainIpc,
	GetUserDataPathMainIpc,
	GetWindowIdMainIpc,
	GetAppVersionMainIpc,
	SetBoundsMainIpc,
];
