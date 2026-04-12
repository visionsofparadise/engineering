import { useEffect } from "react";
import type { SnapshotContext } from "../models/Context";

const SKIP_MS = 5000;

export function useSpectralKeyboard(context: SnapshotContext): void {
	const { playbackEngine, playback, graphStore, graph, wavFile } = context;

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent): void {
			// Do not override shortcuts when an input element is focused
			const target = event.target as HTMLElement;

			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT" ||
				target.isContentEditable
			) {
				return;
			}

			switch (event.key) {
				case " ": {
					event.preventDefault();

					if (playback.isPlaying) {
						playbackEngine.pause();
					} else {
						void playbackEngine.play();
					}

					break;
				}

				case "Home": {
					event.preventDefault();
					playbackEngine.seek(0);

					break;
				}

				case "End": {
					event.preventDefault();
					playbackEngine.seek(wavFile.durationMs);

					break;
				}

				case "ArrowLeft": {
					event.preventDefault();

					const currentMs = playback.currentMs.value;
					const newMs = Math.max(0, currentMs - SKIP_MS);

					playbackEngine.seek(newMs);

					break;
				}

				case "ArrowRight": {
					event.preventDefault();

					const currentMs = playback.currentMs.value;
					const newMs = Math.min(wavFile.durationMs, currentMs + SKIP_MS);

					playbackEngine.seek(newMs);

					break;
				}

				case "z": {
					if (event.ctrlKey || event.metaKey) {
						event.preventDefault();

						if (event.shiftKey) {
							context.redo();
						} else {
							context.undo();
						}
					}

					break;
				}

				case "Z": {
					// Ctrl+Shift+Z on some keyboards sends capital Z
					if (event.ctrlKey || event.metaKey) {
						event.preventDefault();
						context.redo();
					}

					break;
				}

				case "Escape": {
					event.preventDefault();
					graphStore.mutate(graph, (proxy) => {
						proxy.spectralNodeId = null;
					});

					break;
				}
			}
		}

		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [playbackEngine, playback, graphStore, graph, wavFile, context]);
}
