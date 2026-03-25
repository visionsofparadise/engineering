import { useEffect, useMemo, useState } from "react";
import { LoudnessCanvas, SpectrogramCanvas, WaveformCanvas, useSpectralCompute } from "spectral-display";
import type { SpectralConfig, SpectralOptions } from "spectral-display";
import { loadAudio, type AudioData } from "./audio-loader";

const WIDTH = 800;
const HEIGHT = 200;

export const App = () => {
	const [audioData, setAudioData] = useState<AudioData | null>(null);
	const [startMs, setStartMs] = useState(0);
	const [endMs, setEndMs] = useState(0);
	const width = WIDTH;
	const height = HEIGHT;
	const waveformColor: [number, number, number] = [0, 255, 0];

	useEffect(() => {
		let cancelled = false;

		void loadAudio("/test-music.wav").then((data) => {
			if (cancelled) return;

			setAudioData(data);
			setStartMs(0);
			setEndMs((data.totalSamples / data.sampleRate) * 1000);
		});

		return () => {
			cancelled = true;
		};
	}, []);

	const config = useMemo<Partial<SpectralConfig>>(
		() => ({
			fftSize: 4096,
			frequencyScale: "mel",
			colormap: "lava",
		}),
		[],
	);

	const spectralOptions = useMemo<SpectralOptions>(
		() => ({
			metadata: {
				sampleRate: audioData?.sampleRate ?? 0,
				sampleCount: audioData?.totalSamples ?? 0,
				channelCount: audioData?.channels ?? 1,
			},
			query: { startMs, endMs, width, height },
			readSamples: audioData?.readSamples ?? (() => Promise.resolve(new Float32Array(0))),
			config,
		}),
		[audioData, startMs, endMs, width, height, config],
	);

	const computeResult = useSpectralCompute(spectralOptions);

	if (!audioData) {
		return <div style={{ padding: 24, background: "#111", color: "#ccc", minHeight: "100vh" }}>Loading audio...</div>;
	}

	if (computeResult.status === "error") {
		return <div style={{ padding: 24, background: "#111", color: "#f44", minHeight: "100vh" }}>{computeResult.error.message}</div>;
	}

	if (computeResult.status === "idle") {
		return <div style={{ padding: 24, background: "#111", color: "#ccc", minHeight: "100vh" }}>Computing...</div>;
	}

	const canvasStyle = { background: "#000", display: "inline-block" };

	return (
		<div style={{ padding: 24, fontFamily: "monospace", background: "#111", color: "#ccc", minHeight: "100vh" }}>
			<h2 style={{ color: "#888", marginBottom: 8 }}>Spectrogram</h2>
			<div style={canvasStyle}>
				<SpectrogramCanvas computeResult={computeResult} />
			</div>

			<h2 style={{ color: "#888", marginTop: 24, marginBottom: 8 }}>Waveform</h2>
			<div style={canvasStyle}>
				<WaveformCanvas computeResult={computeResult} color={waveformColor} />
			</div>

			<h2 style={{ color: "#888", marginTop: 24, marginBottom: 8 }}>Loudness</h2>
			<div style={{ ...canvasStyle, position: "relative", width, height }}>
				<canvas width={width} height={height} style={{ background: "#000" }} />
				<div style={{ position: "absolute", top: 0, left: 0 }}>
					<LoudnessCanvas
						computeResult={computeResult}
						rmsEnvelope
						momentary
						shortTerm
						integrated
						truePeak
					/>
				</div>
			</div>

			<h2 style={{ color: "#888", marginTop: 24, marginBottom: 8 }}>Combined</h2>
			<div style={{ ...canvasStyle, position: "relative", width, height }}>
				<SpectrogramCanvas computeResult={computeResult} />
				<div style={{ position: "absolute", top: 0, left: 0 }}>
					<WaveformCanvas computeResult={computeResult} color={waveformColor} />
				</div>
				<div style={{ position: "absolute", top: 0, left: 0 }}>
					<LoudnessCanvas
						computeResult={computeResult}
						rmsEnvelope
						momentary
						shortTerm
						integrated
						truePeak
					/>
				</div>
			</div>
		</div>
	);
};
