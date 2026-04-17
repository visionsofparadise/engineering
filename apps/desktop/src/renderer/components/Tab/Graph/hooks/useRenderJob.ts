import type { IpcRendererEvent } from "electron";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AudioChainCompletePayload, AudioProgressPayload } from "../../../../../shared/utilities/emitToRenderer";
import type { GraphContext } from "../../../../models/Context";

export interface UseRenderJobReturn {
	readonly startRender: () => Promise<void>;
	readonly abortRender: () => Promise<void>;
	readonly activeJobId: string | null;
	readonly processingNodes: Map<string, number>;
	readonly errorNodes: Set<string>;
}

export function useRenderJob(context: GraphContext, refresh: () => void): UseRenderJobReturn {
	const [activeJobId, setActiveJobId] = useState<string | null>(null);
	const [processingNodes, setProcessingNodes] = useState<Map<string, number>>(() => new Map());
	const [errorNodes, setErrorNodes] = useState<Set<string>>(() => new Set());

	// Ref to access current activeJobId inside event handlers without stale closures
	const activeJobIdRef = useRef<string | null>(null);

	useEffect(() => {
		activeJobIdRef.current = activeJobId;
	}, [activeJobId]);

	const startRender = useCallback(async () => {
		const result = await context.main.audioRenderGraph({
			bagId: context.graphDefinition.id,
			graphDefinition: context.graphDefinition,
			snapshotsDir: `${context.userDataPath}/snapshots`,
		});

		setActiveJobId(result.jobId);
		setProcessingNodes(new Map());
		setErrorNodes(new Set());
	}, [context]);

	const abortRender = useCallback(async () => {
		if (activeJobIdRef.current === null) return;

		await context.main.audioAbortJob(activeJobIdRef.current);
		setActiveJobId(null);
		setProcessingNodes(new Map());
	}, [context.main]);

	// Subscribe to audio:progress events
	useEffect(() => {
		const handler = (_event: IpcRendererEvent, payload: AudioProgressPayload): void => {
			if (payload.jobId !== activeJobIdRef.current) return;

			setProcessingNodes((previous) => {
				const next = new Map(previous);

				next.set(payload.nodeId, payload.framesProcessed / payload.sourceTotalFrames);

				return next;
			});
		};

		context.main.events.on("audio:progress", handler);

		return () => {
			context.main.events.removeListener("audio:progress", handler);
		};
	}, [context.main]);

	// Subscribe to audio:chainComplete events
	useEffect(() => {
		const handler = (_event: IpcRendererEvent, payload: AudioChainCompletePayload): void => {
			if (payload.jobId !== activeJobIdRef.current) return;

			switch (payload.status) {
				case "completed": {
					setActiveJobId(null);
					setProcessingNodes(new Map());
					refresh();
					break;
				}

				case "failed": {
					setProcessingNodes((previous) => {
						setErrorNodes(new Set(previous.keys()));

						return new Map();
					});
					setActiveJobId(null);
					break;
				}

				case "aborted": {
					setActiveJobId(null);
					setProcessingNodes(new Map());
					break;
				}
			}
		};

		context.main.events.on("audio:chainComplete", handler);

		return () => {
			context.main.events.removeListener("audio:chainComplete", handler);
		};
	}, [context.main, refresh]);

	return { startRender, abortRender, activeJobId, processingNodes, errorNodes };
}
