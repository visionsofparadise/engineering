import { BrowserWindow } from "electron";
import path from "path";
import { JobManager } from "../shared/ipc/Audio/apply/utils/jobManager";
import { ASYNC_MAIN_IPCS } from "../shared/ipc/asyncMainIpcs";
import type { IpcHandlerDependencies } from "../shared/models/AsyncMainIpc";
import { Logger } from "../shared/models/Logger/Logger";
import { getContentSecurityPolicy } from "./getContentSecurityPolicy";
import { createModuleRegistry } from "../shared/models/ModuleRegistry";

export interface WindowFactoryDependencies {
	readonly logger: Logger;
}

const WINDOW_CONFIG = {
	width: 1200,
	height: 800,
	minWidth: 600,
	minHeight: 400,
	titleBarStyle: "hidden" as const,
	titleBarOverlay: {
		color: "#0a0a0a",
		symbolColor: "#e5e5e5",
		height: 44,
	},
};

export const createWindow = (dependencies: WindowFactoryDependencies): BrowserWindow => {
	const { logger } = dependencies;

	const transactionId = Logger.generateTransactionId();

	logger.info("Creating main window", { namespace: "window", transactionId, action: "createWindow" });

	const browserWindow = new BrowserWindow({
		...WINDOW_CONFIG,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.js"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	const isDev = process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL !== undefined;

	browserWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
		callback({
			responseHeaders: {
				...details.responseHeaders,
				"Content-Security-Policy": [getContentSecurityPolicy(isDev)],
			},
		});
	});

	const windowId = crypto.randomUUID();

	const jobManager = new JobManager();
	const moduleRegistry = createModuleRegistry();

	const ipcDependencies: IpcHandlerDependencies = {
		browserWindow,
		jobManager,
		logger,
		moduleRegistry,
		windowId,
	};

	for (const AsyncMainIpc of ASYNC_MAIN_IPCS) {
		new AsyncMainIpc().register(ipcDependencies);
	}

	logger.info("IPC handlers registered for window", { namespace: "window", transactionId, count: String(ASYNC_MAIN_IPCS.length) });

	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	const emitBounds = (): void => {
		const { x, y, width, height } = browserWindow.getBounds();
		const maximized = browserWindow.isMaximized();

		browserWindow.webContents.send("windowBoundsChanged", { x, y, width, height, maximized });
	};

	const debouncedEmit = (): void => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(emitBounds, 500);
	};

	browserWindow.on("move", debouncedEmit);
	browserWindow.on("resize", debouncedEmit);
	browserWindow.on("close", () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		emitBounds();
	});

	if (process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL) {
		browserWindow.loadURL(process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL).catch((error: unknown) => {
			logger.error("Failed to load dev server URL", error as Error, {
				namespace: "window",
				transactionId,
				url: process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL,
			});
		});
	} else {
		const filePath = path.join(__dirname, `../../renderer/${process.env.MAIN_WINDOW_VITE_NAME}/index.html`);

		browserWindow.loadFile(filePath).catch((error: unknown) => {
			logger.error("Failed to load file", error as Error, { namespace: "window", transactionId, filePath });
		});
	}

	browserWindow.on("ready-to-show", () => {
		logger.info("Main window ready to show", { namespace: "window", transactionId });
		browserWindow.show();
	});

	return browserWindow;
};
