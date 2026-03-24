interface AudioData {
  sampleRate: number;
  channels: number;
  totalSamples: number;
  readSamples: (channel: number, offset: number, count: number) => Promise<Float32Array>;
}

async function loadAudio(url: string): Promise<AudioData> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  const audioContext = new OfflineAudioContext(1, 1, 44100);
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const sampleRate = audioBuffer.sampleRate;
  const channels = audioBuffer.numberOfChannels;
  const totalSamples = audioBuffer.length;

  const channelData: Array<Float32Array> = [];

  for (let channel = 0; channel < channels; channel++) {
    channelData.push(audioBuffer.getChannelData(channel));
  }

  const readSamples = (channel: number, offset: number, count: number): Promise<Float32Array> => {
    const samples = channelData[channel];

    if (!samples) {
      return Promise.resolve(new Float32Array(0));
    }

    const end = Math.min(offset + count, totalSamples);

    return Promise.resolve(samples.subarray(offset, end));
  };

  return {
    sampleRate,
    channels,
    totalSamples,
    readSamples,
  };
}

export { loadAudio, type AudioData };
