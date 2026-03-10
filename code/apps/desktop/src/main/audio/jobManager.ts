import { randomUUID } from "node:crypto";

interface ActiveJob {
	readonly id: string;
	readonly controller: AbortController;
}

let activeJob: ActiveJob | undefined;

export function startJob(): { id: string; signal: AbortSignal } {
	if (activeJob) {
		throw new Error("A job is already active");
	}
	const controller = new AbortController();
	const id = randomUUID();
	activeJob = { id, controller };
	return { id, signal: controller.signal };
}

export function abortJob(id: string): void {
	if (activeJob?.id === id) {
		activeJob.controller.abort();
		activeJob = undefined;
	}
}

export function completeJob(id: string): void {
	if (activeJob?.id === id) {
		activeJob = undefined;
	}
}

export function getActiveJob(): ActiveJob | undefined {
	return activeJob;
}
