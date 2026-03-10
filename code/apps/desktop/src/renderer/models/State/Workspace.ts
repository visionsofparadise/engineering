import type { Snapshot } from "valtio/vanilla";
import type { State } from ".";
import { useCreateState } from "../ProxyStore/hooks/useCreateState";
import type { ProxyStore } from "../ProxyStore/ProxyStore";
import { Transient } from "../Transient";

export interface WorkspaceState extends State {
	readonly pixelsPerSecond: Transient<number>;
	readonly scrollX: Transient<number>;
	readonly viewportWidth: Transient<number>;
	readonly viewportHeight: Transient<number>;
	readonly cursorX: Transient<number>;
}

export function useWorkspaceState(store: ProxyStore): Snapshot<WorkspaceState> {
	return useCreateState<WorkspaceState>(
		{
			pixelsPerSecond: new Transient(100, { minimum: 10, maximum: 8192 }),
			scrollX: new Transient(0, { minimum: 0 }),
			viewportWidth: new Transient(0),
			viewportHeight: new Transient(0),
			cursorX: new Transient(-1),
		},
		store,
	);
}
