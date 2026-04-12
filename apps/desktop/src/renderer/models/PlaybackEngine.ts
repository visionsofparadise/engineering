import type { ProxyStore } from "./ProxyStore/ProxyStore";
import type { PlaybackState } from "./State/Playback";
import type { SelectionState } from "./State/Selection";
import type { Mutable } from "./State";

export class PlaybackEngine {
	private readonly store: ProxyStore;
	private readonly playbackKey: symbol;
	private readonly selectionKey: symbol;

	private readonly audio: HTMLAudioElement;
	private readonly audioContext: AudioContext;
	private readonly sourceNode: MediaElementAudioSourceNode;
	private readonly gainNode: GainNode;

	private rafId: number | null = null;
	private sourcePath: string | null = null;
	private sampleRate = 44100;

	constructor(store: ProxyStore, playbackKey: symbol, selectionKey: symbol) {
		this.store = store;
		this.playbackKey = playbackKey;
		this.selectionKey = selectionKey;

		this.audio = new Audio();
		this.audio.crossOrigin = "anonymous";

		this.audioContext = new AudioContext();
		this.sourceNode = this.audioContext.createMediaElementSource(this.audio);
		this.gainNode = this.audioContext.createGain();

		this.sourceNode.connect(this.gainNode);
		this.gainNode.connect(this.audioContext.destination);
	}

	setSource(path: string, sampleRate: number): void {
		this.sourcePath = path;
		this.sampleRate = sampleRate;

		// Reset audio element src so it picks up the new source on next play
		this.audio.src = "";
	}

	async play(): Promise<void> {
		if (!this.sourcePath) return;

		const playback = this.getPlaybackProxy();

		if (!playback) return;

		if (!this.audio.src || this.audio.src === "") {
			this.audio.src = `media://${this.sourcePath}`;
		}

		if (this.audioContext.state === "suspended") {
			await this.audioContext.resume();
		}

		await this.audio.play();
		playback.isPlaying = true;
		this.startRafLoop();
	}

	pause(): void {
		this.audio.pause();
		this.stopRafLoop();

		const playback = this.getPlaybackProxy();

		if (!playback) return;

		playback.currentMs.committed.value = this.audio.currentTime * 1000;
		playback.isPlaying = false;
	}

	stop(): void {
		this.audio.pause();
		this.stopRafLoop();

		const playback = this.getPlaybackProxy();

		if (!playback) return;

		const startMs = this.getLoopStartMs();

		this.audio.currentTime = startMs / 1000;

		playback.currentMs.committed.value = startMs;
		playback.isPlaying = false;
	}

	seek(ms: number): void {
		this.audio.currentTime = ms / 1000;

		const playback = this.getPlaybackProxy();

		if (!playback) return;

		if (playback.isPlaying) {
			playback.currentMs.transient.value = ms;
		} else {
			playback.currentMs.committed.value = ms;
		}
	}

	setVolume(volume: number): void {
		this.gainNode.gain.value = volume;

		const playback = this.getPlaybackProxy();

		if (!playback) return;

		playback.volume = volume;
	}

	setPlaybackRate(rate: number): void {
		this.audio.playbackRate = rate;

		const playback = this.getPlaybackProxy();

		if (!playback) return;

		playback.playbackRate = rate;
	}

	dispose(): void {
		this.audio.pause();
		this.stopRafLoop();

		this.sourceNode.disconnect();
		this.gainNode.disconnect();
		void this.audioContext.close();

		this.audio.removeAttribute("src");
		this.audio.load();
	}

	private getPlaybackProxy(): Mutable<PlaybackState> | undefined {
		return this.store.dangerouslyGetProxy<Mutable<PlaybackState>>(this.playbackKey);
	}

	private getSelectionProxy(): Mutable<SelectionState> | undefined {
		return this.store.dangerouslyGetProxy<Mutable<SelectionState>>(this.selectionKey);
	}

	private getLoopStartMs(): number {
		const playback = this.getPlaybackProxy();

		if (!playback?.isLooping) return 0;

		const selection = this.getSelectionProxy();

		if (selection?.active) {
			return (selection.startFrame.value / this.sampleRate) * 1000;
		}

		return 0;
	}

	private getLoopEndMs(): number {
		const playback = this.getPlaybackProxy();

		const selection = this.getSelectionProxy();

		if (playback?.isLooping && selection?.active) {
			return (selection.endFrame.value / this.sampleRate) * 1000;
		}

		return this.audio.duration * 1000;
	}

	private startRafLoop(): void {
		this.stopRafLoop();

		const tick = (): void => {
			const playback = this.getPlaybackProxy();

			if (!playback) return;

			const currentMs = this.audio.currentTime * 1000;
			const endMs = this.getLoopEndMs();

			if (currentMs >= endMs) {
				if (playback.isLooping) {
					const startMs = this.getLoopStartMs();

					this.audio.currentTime = startMs / 1000;
					playback.currentMs.transient.value = startMs;
				} else {
					this.stop();

					return;
				}
			} else {
				playback.currentMs.transient.value = currentMs;
			}

			this.rafId = requestAnimationFrame(tick);
		};

		this.rafId = requestAnimationFrame(tick);
	}

	private stopRafLoop(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
	}
}
