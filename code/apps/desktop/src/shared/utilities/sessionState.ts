import { createHash } from "node:crypto";
import { SessionStateSchema, type SessionState } from "../models/Session";

export function getSessionStatePath(userDataPath: string, bagPath: string): string {
	const hash = createHash("sha256").update(bagPath).digest("hex").slice(0, 16);

	return `${userDataPath}/sessions/${hash}.json`;
}

export async function loadSessionState(userDataPath: string, bagPath: string): Promise<SessionState | null> {
	try {
		const filePath = getSessionStatePath(userDataPath, bagPath);
		const content = await window.main.readFile(filePath);

		return SessionStateSchema.parse(JSON.parse(content));
	} catch {
		return null;
	}
}

export async function saveSessionState(userDataPath: string, bagPath: string, state: SessionState): Promise<void> {
	const filePath = getSessionStatePath(userDataPath, bagPath);
	const sessionsDir = `${userDataPath}/sessions`;

	await window.main.ensureDirectory(sessionsDir);
	await window.main.writeFile(filePath, JSON.stringify(state, undefined, 2));
}
