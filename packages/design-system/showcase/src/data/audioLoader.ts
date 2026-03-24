export interface AudioData {
  sampleRate: number;
  channels: number;
  totalSamples: number;
  durationMs: number;
  readSamples: (channel: number, sampleOffset: number, sampleCount: number) => Promise<Float32Array>;
}

export async function loadAudio(url: string): Promise<AudioData> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioContext = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;
  const durationMs = (totalSamples / sampleRate) * 1000;

  const channelData: Array<Float32Array> = [];

  for (let ch = 0; ch < channels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  const readSamples = (channel: number, sampleOffset: number, sampleCount: number): Promise<Float32Array> => {
    const samples = channelData[channel];

    if (!samples) {
      return Promise.resolve(new Float32Array(0));
    }

    const end = Math.min(sampleOffset + sampleCount, totalSamples);

    return Promise.resolve(samples.subarray(sampleOffset, end));
  };

  return { sampleRate, channels, totalSamples, durationMs, readSamples };
}
