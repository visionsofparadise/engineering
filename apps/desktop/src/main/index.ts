import { app, BrowserWindow } from "electron";
import { Logger } from "../shared/models/Logger/Logger";
import { createWindow } from "./createWindow";

const logger = new Logger("main");
Logger.level = "debug";

app.whenReady().then(() => createWindow({ logger })).catch(console.error);

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) {
		void createWindow({ logger });
	}
});
