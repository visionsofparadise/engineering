import { useEffect, useMemo, useRef, useState } from "react";
import type { ComputeResult, FrequencyScale } from "@e9g/spectral-display";
import { useSpectralCompute } from "@e9g/spectral-display";
import type { GraphContext, SnapshotContext } from "../../../models/Context";
import { ProxyStore } from "../../../models/ProxyStore/ProxyStore";
import { useCreateState } from "../../../models/ProxyStore/hooks/useCreateState";
import { createSnapshotState } from "../../../models/State/Snapshot";
import type { SnapshotState } from "../../../models/State/Snapshot";
import type { Mutable } from "../../../models/State";
import { createPlaybackState } from "../../../models/State/Playback";
import type { PlaybackState } from "../../../models/State/Playback";
import { createSelectionState } from "../../../models/State/Selection";
import type { SelectionState } from "../../../models/State/Selection";
import { PlaybackEngine } from "../../../models/PlaybackEngine";
import { openWavFile } from "../../../utilities/wavFileHandle";
import type { WavFileHandle } from "../../../utilities/wavFileHandle";
import { SpectralView } from "./SpectralView";

const ALGORITHM_TO_SCALE: Record<SnapshotState["spectrogramAlgorithm"], FrequencyScale> = {
	log: "log",
	mel: "mel",
	ERB: "erb",
	linear: "linear",
};

interface LoadedData {
	readonly wavFile: WavFileHandle;
	readonly snapshotHash: string;
	readonly snapshotAudioPath: string;
}

async function loadSnapshotData(
	context: GraphContext,
	spectralNodeId: string,
): Promise<LoadedData> {
	const snapshotDir = `${context.userDataPath}/snapshots/${context.bagId}/${spectralNodeId}/`;
	const entries = await context.main.readDirectory(snapshotDir);

	if (entries.length === 0) {
		throw new Error("No snapshots found");
	}

	const hash = entries[entries.length - 1];

	if (hash === undefined) {
		throw new Error("No snapshot hash found");
	}

	const audioPath = `${context.userDataPath}/snapshots/${context.bagId}/${spectralNodeId}/${hash}/audio.wav`;
	const wavFile = await openWavFile(context.main, audioPath);

	return { wavFile, snapshotHash: hash, snapshotAudioPath: audioPath };
}

interface Props {
	readonly context: GraphContext;
	readonly spectralNodeId: string;
}

export function SnapshotSession({ context, spectralNodeId }: Props) {
	const [loaded, setLoaded] = useState<LoadedData | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		let stale = false;

		loadSnapshotData(context, spectralNodeId)
			.then((data) => {
				if (stale) {
					void data.wavFile.close();
				} else {
					setLoaded(data);
				}
			})
			.catch((thrown: unknown) => {
				if (!stale) {
					setLoadError(thrown instanceof Error ? thrown.message : String(thrown));
				}
			});

		return () => {
			stale = true;

			setLoaded((previous) => {
				if (previous) void previous.wavFile.close();

				return null;
			});
		};
	}, [context, spectralNodeId]);

	if (loadError) {
		return <div className="flex h-full items-center justify-center font-technical text-chrome-text-secondary">{loadError}</div>;
	}

	if (!loaded) {
		return <div className="flex h-full items-center justify-center font-technical text-chrome-text-secondary">Loading...</div>;
	}

	return <SnapshotSessionInner context={context} loaded={loaded} />;
}

interface InnerProps {
	readonly context: GraphContext;
	readonly loaded: LoadedData;
}

function SnapshotSessionInner({ context, loaded }: InnerProps) {
	const { wavFile, snapshotHash, snapshotAudioPath } = loaded;

	const snapshotStore = useMemo(() => new ProxyStore(), []);

	const snapshot = useCreateState<SnapshotState>(createSnapshotState(snapshotHash), snapshotStore);
	const playback = useCreateState<PlaybackState>(createPlaybackState(), snapshotStore);
	const selection = useCreateState<SelectionState>(createSelectionState(), snapshotStore);

	const engine = useMemo(
		() => new PlaybackEngine(snapshotStore, playback._key, selection._key),
		[snapshotStore, playback._key, selection._key],
	);

	useEffect(() => {
		engine.setSource(snapshotAudioPath, wavFile.sampleRate);
	}, [engine, snapshotAudioPath, wavFile.sampleRate]);

	useEffect(
		() => () => {
			engine.dispose();
		},
		[engine],
	);

	// Debounced commit: when transient scroll/zoom values stabilize, commit them
	// to trigger React re-render and GPU recompute
	const proxy = useMemo(
		() => snapshotStore.dangerouslyGetProxy<Mutable<SnapshotState>>(snapshot._key),
		[snapshotStore, snapshot._key],
	);

	const commitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		if (!proxy) return;

		const unsubscribes = [
			proxy.scrollX.watch(() => {
				clearTimeout(commitTimerRef.current);

				if (!proxy.scrollX.isDirty && !proxy.pixelsPerSecond.isDirty) return;

				commitTimerRef.current = setTimeout(() => {
					if (proxy.scrollX.isDirty) {
						proxy.scrollX.committed.value = proxy.scrollX.value;
					}

					if (proxy.pixelsPerSecond.isDirty) {
						proxy.pixelsPerSecond.committed.value = proxy.pixelsPerSecond.value;
					}

					if (proxy.viewportWidth.isDirty) {
						proxy.viewportWidth.committed.value = proxy.viewportWidth.value;
					}

					if (proxy.viewportHeight.isDirty) {
						proxy.viewportHeight.committed.value = proxy.viewportHeight.value;
					}
				}, 150);
			}),
			proxy.pixelsPerSecond.watch(() => {
				clearTimeout(commitTimerRef.current);

				if (!proxy.scrollX.isDirty && !proxy.pixelsPerSecond.isDirty) return;

				commitTimerRef.current = setTimeout(() => {
					if (proxy.scrollX.isDirty) {
						proxy.scrollX.committed.value = proxy.scrollX.value;
					}

					if (proxy.pixelsPerSecond.isDirty) {
						proxy.pixelsPerSecond.committed.value = proxy.pixelsPerSecond.value;
					}

					if (proxy.viewportWidth.isDirty) {
						proxy.viewportWidth.committed.value = proxy.viewportWidth.value;
					}

					if (proxy.viewportHeight.isDirty) {
						proxy.viewportHeight.committed.value = proxy.viewportHeight.value;
					}
				}, 150);
			}),
			proxy.viewportWidth.watch(() => {
				clearTimeout(commitTimerRef.current);

				commitTimerRef.current = setTimeout(() => {
					if (proxy.viewportWidth.isDirty) {
						proxy.viewportWidth.committed.value = proxy.viewportWidth.value;
					}

					if (proxy.viewportHeight.isDirty) {
						proxy.viewportHeight.committed.value = proxy.viewportHeight.value;
					}
				}, 150);
			}),
			proxy.viewportHeight.watch(() => {
				clearTimeout(commitTimerRef.current);

				commitTimerRef.current = setTimeout(() => {
					if (proxy.viewportWidth.isDirty) {
						proxy.viewportWidth.committed.value = proxy.viewportWidth.value;
					}

					if (proxy.viewportHeight.isDirty) {
						proxy.viewportHeight.committed.value = proxy.viewportHeight.value;
					}
				}, 150);
			}),
		];

		return () => {
			clearTimeout(commitTimerRef.current);

			for (const unsub of unsubscribes) {
				unsub();
			}
		};
	}, [proxy]);

	// Derive GPU compute query from committed snapshot values
	const committedScrollX = snapshot.scrollX._committed;
	const committedPps = snapshot.pixelsPerSecond._committed;
	const committedWidth = snapshot.viewportWidth._committed;
	const committedHeight = snapshot.viewportHeight._committed;

	const computeWidth = committedWidth > 0 ? committedWidth : 800;
	const computeHeight = committedHeight > 0 ? committedHeight : 400;
	const startMs = committedPps > 0 ? (committedScrollX / committedPps) * 1000 : 0;
	const endMs = committedPps > 0
		? Math.min(((committedScrollX + computeWidth) / committedPps) * 1000, wavFile.durationMs)
		: wavFile.durationMs;

	const spectralResult: ComputeResult = useSpectralCompute({
		metadata: {
			sampleRate: wavFile.sampleRate,
			sampleCount: wavFile.totalSamples,
			channelCount: wavFile.channelCount,
		},
		query: {
			startMs,
			endMs,
			width: computeWidth,
			height: computeHeight,
		},
		readSamples: wavFile.readSamples,
		config: {
			frequencyScale: ALGORITHM_TO_SCALE[snapshot.spectrogramAlgorithm],
			fftSize: snapshot.fftSize,
			hopOverlap: snapshot.hopOverlap,
			dbRange: [-snapshot.dbRange, 0],
		},
	});

	const snapshotContext: SnapshotContext = useMemo(
		() => ({
			...context,
			snapshot,
			snapshotStore,
			playback,
			selection,
			playbackEngine: engine,
			spectralResult,
			wavFile,
			snapshotAudioPath,
		}),
		[context, snapshot, snapshotStore, playback, selection, engine, spectralResult, wavFile, snapshotAudioPath],
	);

	return <SpectralView context={snapshotContext} />;
}
