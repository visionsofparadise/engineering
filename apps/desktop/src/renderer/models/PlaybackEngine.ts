import type { Snapshot } from "valtio/vanilla";
import type { ProxyStore } from "./ProxyStore/ProxyStore";
import type { PlaybackState } from "./State/Playback";
import type { SelectionState } from "./State/Selection";

export class PlaybackEngine {
	private readonly _store: ProxyStore;
	private readonly _playback: Snapshot<PlaybackState>;
	private readonly _audio: HTMLAudioElement;
	private _rafId: number | null = null;
	private _durationMs = 0;

	constructor(store: ProxyStore, playback: Snapshot<PlaybackState>) {
		this._store = store;
		this._playback = playback;
		this._audio = new Audio();
		this._audio.preload = "auto";

		this._audio.addEventListener("ended", () => {
			if (this._playback.isLooping) {
				this._audio.currentTime = 0;

				void this._audio.play();
			} else {
				this._stopRafLoop();

				this._store.mutate(this._playback, (proxy) => {
					proxy.isPlaying = false;
				});
			}
		});

		this._audio.addEventListener("loadedmetadata", () => {
			this._durationMs = this._audio.duration * 1000;
		});
	}

	load(audioPath: string): void {
		if (this._playback.isPlaying) {
			this.pause();
		}

		this._audio.src = `media:///${audioPath.replace(/\\/g, "/")}`;

		this._store.mutate(this._playback, (proxy) => {
			proxy.currentMs.committed.value = 0;
		});
	}

	async play(): Promise<void> {
		if (!this._audio.src) return;

		await this._audio.play();

		this._store.mutate(this._playback, (proxy) => {
			proxy.isPlaying = true;
		});

		this._startRafLoop();
	}

	pause(): void {
		this._audio.pause();
		this._stopRafLoop();
		this._commitCurrentMs();

		this._store.mutate(this._playback, (proxy) => {
			proxy.isPlaying = false;
		});
	}

	stop(): void {
		this._audio.pause();
		this._stopRafLoop();
		this._audio.currentTime = 0;

		this._store.mutate(this._playback, (proxy) => {
			proxy.isPlaying = false;
			proxy.currentMs.committed.value = 0;
		});
	}

	seek(ms: number): void {
		const clamped = Math.max(0, Math.min(ms, this._durationMs));
		this._audio.currentTime = clamped / 1000;

		this._store.mutate(this._playback, (proxy) => {
			if (this._playback.isPlaying) {
				proxy.currentMs.transient.value = clamped;
			} else {
				proxy.currentMs.committed.value = clamped;
			}
		});
	}

	skipForward(ms = 5000): void {
		this.seek(this._playback.currentMs.value + ms);
	}

	skipBackward(ms = 5000): void {
		this.seek(this._playback.currentMs.value - ms);
	}

	skipToStart(): void {
		this.seek(0);
	}

	skipToEnd(): void {
		this.seek(this._durationMs);
	}

	setVolume(value: number): void {
		const clamped = Math.max(0, Math.min(1, value));
		this._audio.volume = clamped;

		this._store.mutate(this._playback, (proxy) => {
			proxy.volume = clamped;
		});
	}

	setPlaybackRate(rate: number): void {
		const clamped = Math.max(0.25, Math.min(4, rate));
		this._audio.playbackRate = clamped;

		this._store.mutate(this._playback, (proxy) => {
			proxy.playbackRate = clamped;
		});
	}

	setIsLooping(isLooping: boolean): void {
		this._store.mutate(this._playback, (proxy) => {
			proxy.isLooping = isLooping;
		});
	}

	getLoopBounds(selection: Snapshot<SelectionState> | undefined, sampleRate: number): { startMs: number; endMs: number } {
		if (selection?.active && sampleRate > 0) {
			const startMs = (selection.startFrame.value / sampleRate) * 1000;
			const endMs = (selection.endFrame.value / sampleRate) * 1000;

			return {
				startMs: Math.min(startMs, endMs),
				endMs: Math.max(startMs, endMs),
			};
		}

		return { startMs: 0, endMs: this._durationMs };
	}

	get durationMs(): number {
		return this._durationMs;
	}

	dispose(): void {
		this._stopRafLoop();

		this._audio.pause();
		this._audio.removeAttribute("src");
		this._audio.load();
	}

	private _startRafLoop(): void {
		if (this._rafId !== null) return;

		const tick = (): void => {
			const currentMs = this._audio.currentTime * 1000;
			this._store.mutate(this._playback, (proxy) => {
				proxy.currentMs.transient.value = currentMs;
			});

			if (this._playback.isLooping) {
				const bounds = this.getLoopBounds(undefined, 0);
				if (currentMs >= bounds.endMs && bounds.endMs > 0) {
					this._audio.currentTime = bounds.startMs / 1000;
				}
			}

			this._rafId = requestAnimationFrame(tick);
		};

		this._rafId = requestAnimationFrame(tick);
	}

	private _stopRafLoop(): void {
		if (this._rafId !== null) {
			cancelAnimationFrame(this._rafId);
			this._rafId = null;
		}
	}

	private _commitCurrentMs(): void {
		const currentMs = this._audio.currentTime * 1000;

		this._store.mutate(this._playback, (proxy) => {
			proxy.currentMs.committed.value = currentMs;
		});
	}
}
