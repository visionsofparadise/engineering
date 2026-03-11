import type { BrowserWindow } from "electron";
import type { JobManager } from "../ipc/Audio/apply/utils/jobManager";
import type { LogContext } from "./LogContext";
import { Logger } from "./Logger/Logger";
import type { ModuleRegistryMap } from "./ModuleRegistry";

export interface IpcHandlerDependencies {
	readonly browserWindow: BrowserWindow;
	readonly jobManager: JobManager;
	readonly logger: Logger;
	readonly moduleRegistry: ModuleRegistryMap;
	readonly windowId: string;
}

export abstract class AsyncMainIpc<P extends Array<unknown>, R> {
	abstract action: string;
	abstract handler(...parameters: [...P, IpcHandlerDependencies]): R | Promise<R>;

	log(transactionId: string, _context: LogContext | undefined, logger: Logger): void {
		logger.debug(`Executing IPC handler`, {
			namespace: "ipc",
			transactionId,
			action: this.action,
		});
	}

	register(dependencies: IpcHandlerDependencies): void {
		const { browserWindow, logger } = dependencies;

		browserWindow.webContents.ipc.handle(this.action, async (_event, ...parameters: Array<unknown>) => {
			const transactionId = Logger.generateTransactionId();

			try {
				const logContext = parameters[parameters.length - 1] as LogContext | undefined;

				this.log(transactionId, logContext, logger);

				const result = await this.handler(...(parameters as P), dependencies);

				logger.debug(`IPC handler completed successfully`, {
					namespace: "ipc",
					transactionId,
					action: this.action,
				});

				return result;
			} catch (error) {
				logger.error(`IPC handler failed`, error as Error, {
					namespace: "ipc",
					transactionId,
					action: this.action,
				});
				throw error;
			}
		});
	}
}
