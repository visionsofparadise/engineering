import { useEffect } from "react";
import type { PlaybackEngine } from "../../../models/PlaybackEngine";

interface UseSessionKeyboardParams {
	readonly undo: () => void;
	readonly redo: () => void;
	readonly isPlaying: boolean;
	readonly playbackEngine: PlaybackEngine;
}

export function useSessionKeyboard({ undo, redo, isPlaying, playbackEngine }: UseSessionKeyboardParams): void {
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
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [undo, redo, isPlaying, playbackEngine]);
}
