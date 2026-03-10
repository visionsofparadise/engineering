import type { IpcRendererEvent } from "electron";
import EventEmitter from "events";
import type { MainEventMap } from "../../shared/utilities/emitToRenderer";
import type { Main } from "./Main";

export class MainEvents extends EventEmitter<MainEventMap> {
	constructor(main: Main) {
		super();

		main.events.on("windowBoundsChanged", (_: IpcRendererEvent, ...args) => {
			this.emit("windowBoundsChanged", ...args);
		});

		main.events.on("audio:progress", (_: IpcRendererEvent, ...args) => {
			this.emit("audio:progress", ...args);
		});

		main.events.on("audio:chainComplete", (_: IpcRendererEvent, ...args) => {
			this.emit("audio:chainComplete", ...args);
		});

		main.events.on("audio:moduleComplete", (_: IpcRendererEvent, ...args) => {
			this.emit("audio:moduleComplete", ...args);
		});
	}
}
