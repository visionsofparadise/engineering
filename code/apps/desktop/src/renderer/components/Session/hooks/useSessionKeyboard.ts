import { useEffect } from "react";
import type { Snapshot } from "valtio/vanilla";
import type { useGraph } from "../../../hooks/useGraph";
import type { PlaybackEngine } from "../../../models/PlaybackEngine";
import type { SelectionState } from "../../../models/State/Selection";

interface UseSessionKeyboardParams {
	readonly undo: () => void;
	readonly redo: () => void;
	readonly isPlaying: boolean;
	readonly playbackEngine: PlaybackEngine;
	readonly graph: ReturnType<typeof useGraph>;
	readonly selection: Snapshot<SelectionState>;
}

export function useSessionKeyboard({ undo, redo, isPlaying, playbackEngine, graph, selection }: UseSessionKeyboardParams): void {
	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key === "z") {
				event.preventDefault();
				if (event.shiftKey) {
					redo();
				} else {
					undo();
				}

				return;
			}

			if (event.ctrlKey || event.metaKey || event.altKey) return;

			switch (event.key) {
				case " ":
					event.preventDefault();
					if (isPlaying) {
						playbackEngine.pause();
					} else {
						void playbackEngine.play();
					}

					break;
				case "Home":
					event.preventDefault();
					playbackEngine.skipToStart();
					break;
				case "End":
					event.preventDefault();
					playbackEngine.skipToEnd();
					break;
				case "ArrowLeft":
					event.preventDefault();
					playbackEngine.skipBackward(5000);
					break;
				case "ArrowRight":
					event.preventDefault();
					playbackEngine.skipForward(5000);
					break;
				case "Delete":
				case "Backspace": {
					const monitoredNodeId = graph.sessionState.monitoredNodeId;

					if (!monitoredNodeId) break;
					if (!selection.active) break;

					const sampleRate = playbackEngine.sampleRate;

					if (sampleRate <= 0) break;

					const startSec = selection.startFrame.committed.value / sampleRate;
					const endSec = selection.endFrame.committed.value / sampleRate;

					const cutNode = {
						id: crypto.randomUUID(),
						package: "buffered-audio-nodes",
						node: "Cut",
						options: { regions: [{ start: Math.min(startSec, endSec), end: Math.max(startSec, endSec) }] },
					};

					event.preventDefault();
					graph.insertNodeAfter(monitoredNodeId, cutNode);
					graph.setMonitor(cutNode.id);
					break;
				}
			}
		};

		window.addEventListener("keydown", handleKeyDown);

		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [undo, redo, isPlaying, playbackEngine, graph, selection]);
}
