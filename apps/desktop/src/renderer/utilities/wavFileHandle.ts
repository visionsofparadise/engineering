import type { Main } from "../models/Main";

export interface WavFileHandle {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly totalSamples: number;
	readonly durationMs: number;
	readSamples: (channel: number, sampleOffset: number, sampleCount: number) => Promise<Float32Array>;
	close: () => Promise<void>;
}

const RIFF = 0x52494646;
const WAVE = 0x57415645;
const FMT = 0x666d7420;
const DATA = 0x64617461;

const PCM_FORMAT = 1;
const IEEE_FLOAT_FORMAT = 3;

interface WavHeader {
	readonly audioFormat: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly bitsPerSample: number;
	readonly blockAlign: number;
	readonly dataOffset: number;
	readonly dataSize: number;
}

function findChunk(view: DataView, chunkId: number, searchStart: number): number {
	let offset = searchStart;

	while (offset + 8 <= view.byteLength) {
		const id = view.getUint32(offset, false);

		if (id === chunkId) return offset;
		const size = view.getUint32(offset + 4, true);

		offset += 8 + size;
		// Chunks are word-aligned
		if (size % 2 !== 0) offset += 1;
	}

	return -1;
}

function parseWavHeader(buffer: ArrayBuffer): WavHeader {
	const view = new DataView(buffer);

	if (view.getUint32(0, false) !== RIFF) throw new Error("Not a RIFF file");
	if (view.getUint32(8, false) !== WAVE) throw new Error("Not a WAVE file");

	const fmtOffset = findChunk(view, FMT, 12);

	if (fmtOffset === -1) throw new Error("Missing fmt chunk");

	const audioFormat = view.getUint16(fmtOffset + 8, true);

	if (audioFormat !== PCM_FORMAT && audioFormat !== IEEE_FLOAT_FORMAT) {
		throw new Error(`Unsupported audio format: ${audioFormat}`);
	}

	const channelCount = view.getUint16(fmtOffset + 10, true);
	const sampleRate = view.getUint32(fmtOffset + 12, true);
	const bitsPerSample = view.getUint16(fmtOffset + 22, true);
	const blockAlign = view.getUint16(fmtOffset + 20, true);

	const dataOffset = findChunk(view, DATA, 12);

	if (dataOffset === -1) throw new Error("Missing data chunk");

	const dataSize = view.getUint32(dataOffset + 4, true);

	return {
		audioFormat,
		channelCount,
		sampleRate,
		bitsPerSample,
		blockAlign,
		dataOffset: dataOffset + 8,
		dataSize,
	};
}

function deinterleave(
	buffer: ArrayBuffer,
	channel: number,
	channelCount: number,
	bitsPerSample: number,
	audioFormat: number,
	sampleCount: number,
): Float32Array {
	const bytesPerSample = bitsPerSample / 8;
	const view = new DataView(buffer);
	const output = new Float32Array(sampleCount);

	for (let si = 0; si < sampleCount; si++) {
		const frameOffset = si * channelCount * bytesPerSample;
		const sampleByteOffset = frameOffset + channel * bytesPerSample;

		if (audioFormat === IEEE_FLOAT_FORMAT && bitsPerSample === 32) {
			output[si] = view.getFloat32(sampleByteOffset, true);
		} else if (bitsPerSample === 16) {
			output[si] = view.getInt16(sampleByteOffset, true) / 32768;
		} else if (bitsPerSample === 24) {
			const b0 = view.getUint8(sampleByteOffset);
			const b1 = view.getUint8(sampleByteOffset + 1);
			const b2 = view.getUint8(sampleByteOffset + 2);
			let value = b0 | (b1 << 8) | (b2 << 16);

			if (value >= 0x800000) value -= 0x1000000;
			output[si] = value / 8388608;
		} else {
			throw new Error(`Unsupported bit depth: ${bitsPerSample}`);
		}
	}

	return output;
}

export async function openWavFile(main: Main, filePath: string): Promise<WavFileHandle> {
	const handleId = await main.openFileHandle(filePath);

	try {
		const headerBuffer = await main.readFileHandle(handleId, 0, 100);
		const header = parseWavHeader(headerBuffer);

		const bytesPerSample = header.bitsPerSample / 8;
		const totalSamples = header.dataSize / (header.channelCount * bytesPerSample);
		const durationMs = (totalSamples / header.sampleRate) * 1000;

		return {
			sampleRate: header.sampleRate,
			channelCount: header.channelCount,
			totalSamples,
			durationMs,

			async readSamples(channel: number, sampleOffset: number, sampleCount: number): Promise<Float32Array> {
				const byteOffset = header.dataOffset + sampleOffset * header.blockAlign;
				const byteLength = sampleCount * header.blockAlign;
				const buffer = await main.readFileHandle(handleId, byteOffset, byteLength);

				return deinterleave(
					buffer,
					channel,
					header.channelCount,
					header.bitsPerSample,
					header.audioFormat,
					sampleCount,
				);
			},

			async close(): Promise<void> {
				await main.closeFileHandle(handleId);
			},
		};
	} catch (error) {
		await main.closeFileHandle(handleId);
		throw error;
	}
}
