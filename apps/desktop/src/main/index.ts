import { app, BrowserWindow, protocol } from "electron";
import { logger } from "./logger";
import { createWindow } from "./window";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron Forge requires this pattern
if (require("electron-squirrel-startup")) {
	app.quit();
}

protocol.registerSchemesAsPrivileged([
	{ scheme: "media", privileges: { stream: true, supportFetchAPI: true, secure: true } },
]);

app.whenReady()
	.then(() => createWindow(logger))
	.catch(console.error);

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		createWindow(logger);
	}
});
